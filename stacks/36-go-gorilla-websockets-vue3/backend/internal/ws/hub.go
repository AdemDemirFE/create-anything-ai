// Package ws implements the hand-rolled WebSocket hub — the çırak (apprentice)
// paradigm of Stack 36 and the deliberate contrast with Stack 35, where
// ASP.NET Core SignalR + a Redis backplane abstraction provide group
// management, reconnection, and backpressure out of the box. Here NOTHING is
// provided: the hub, membership, fan-out, and slow-client policy are written
// by hand on top of gorilla/websocket's raw connection API.
//
// CONCURRENCY MODEL (gorilla's own chat example pattern, made explicit):
//
//   - Hub owns clients map[Client]struct{} guarded by one mutex-free
//     goroutine (state channel) — single-writer, so no map races.
//   - Each Client has ONE buffered send channel. The hub never writes to a
//     conn directly; it appends to the channel, and the client's writer
//     goroutine is the ONLY writer to the TCP connection (gorilla requires a
//     single concurrent writer per conn).
//   - Reads happen ONLY in the client's reader goroutine (gorilla requires a
//     single concurrent reader per conn).
//   - Slow-client drop policy: if a client's send buffer is full when the hub
//     tries to enqueue a broadcast, the hub does NOT block (that would stall
//     every other client) and does NOT silently grow memory; it closes the
//     send channel (making the writer exit) and unregisters the client. The
//     writer goroutine additionally enforces a write deadline per message, so
//     a stuck TCP peer cannot hold the goroutine forever — a write that
//     overruns WriteWait fails and tears the client down the same path.
package ws

import (
	"sync"
	"time"
)

// Client is one connected WebSocket peer. One Client per TCP connection.
// Send is the buffered outbound channel; the hub (or an app-level sender)
// enqueues and the client's writer goroutine is the ONLY writer to the TCP
// connection (gorilla requires a single concurrent writer per conn).
type Client struct {
	// Email is the authenticated identity resolved at upgrade time.
	Email string
	// Send carries outbound JSON messages TO this client. Buffered;
	// capacity = Config.SendBuffer. Closed exactly once by CloseOnce.
	Send chan []byte

	hub     *Hub
	closed  bool
	closeMu sync.Mutex
}

// SendMsg delivers a message to the client without blocking. It returns
// false when the client is closing or its buffer is full (the caller treats
// both as "drop this client").
func (c *Client) SendMsg(msg []byte) bool {
	c.closeMu.Lock()
	defer c.closeMu.Unlock()
	if c.closed {
		return false
	}
	select {
	case c.Send <- msg:
		return true
	default:
		// Buffer full: the client cannot keep up.
		return false
	}
}

// CloseOnce marks the client closed and closes the send channel exactly once.
// The writer goroutine exits when the channel closes.
func (c *Client) CloseOnce() {
	c.closeMu.Lock()
	defer c.closeMu.Unlock()
	if c.closed {
		return
	}
	c.closed = true
	close(c.Send)
}

// Config controls the hub's keepalive and backpressure behavior.
type Config struct {
	// SendBuffer is the per-client outbound queue capacity (messages).
	SendBuffer int
	// PingPeriod is how often the writer sends a WebSocket PING. Must be
	// < PongWait (the standard pattern leaves ~10% headroom).
	PingPeriod time.Duration
	// PongWait is how long the reader tolerates silence before declaring
	// the connection dead (the read deadline is bumped on every PONG).
	PongWait time.Duration
	// WriteWait is the per-write deadline: a single message write must
	// complete within this budget or the client is torn down.
	WriteWait time.Duration
}

// DefaultConfig returns the documented keepalive/backpressure policy.
func DefaultConfig() Config {
	return Config{
		SendBuffer: 16,
		PingPeriod: 30 * time.Second,
		PongWait:   45 * time.Second,
		WriteWait:  10 * time.Second,
	}
}

// message is one broadcast frame the hub fans out verbatim.
type message struct {
	payload []byte
}

// Hub is the hand-written membership + fan-out core. It is safe for
// concurrent use: registration state changes are serialized through the
// state channel (single goroutine owner); broadcast walks the snapshot.
type Hub struct {
	cfg Config

	// register/unregister/unregisterAll carry client state transitions to
	// the run goroutine (single-writer over the map — no mutex).
	register   chan *Client
	unregister chan *Client
	broadcastC chan message

	mu      sync.RWMutex
	clients map[*Client]struct{}
	// done closes when Run exits; Stop is idempotent.
	done chan struct{}
	once sync.Once
}

// NewHub builds a hub with the given config (nil = DefaultConfig).
func NewHub(cfg *Config) *Hub {
	if cfg == nil {
		c := DefaultConfig()
		cfg = &c
	}
	h := &Hub{
		cfg:        *cfg,
		register:   make(chan *Client),
		unregister: make(chan *Client),
		broadcastC: make(chan message, 64),
		clients:    make(map[*Client]struct{}),
		done:       make(chan struct{}),
	}
	return h
}

// Run is the hub's event loop. It owns the clients map; start it exactly
// once per hub (New + go hub.Run()).
func (h *Hub) Run() {
	for {
		select {
		case c := <-h.register:
			h.mu.Lock()
			h.clients[c] = struct{}{}
			h.mu.Unlock()
		case c := <-h.unregister:
			h.mu.Lock()
			delete(h.clients, c)
			h.mu.Unlock()
		case msg := <-h.broadcastC:
			h.mu.RLock()
			snapshot := make([]*Client, 0, len(h.clients))
			for c := range h.clients {
				snapshot = append(snapshot, c)
			}
			h.mu.RUnlock()
			var dropped []*Client
			for _, c := range snapshot {
				if !c.SendMsg(msg.payload) {
					// Slow client or closing: drop it. The drop is the
					// documented backpressure policy — never block the
					// hub, never buffer unboundedly. CloseOnce is safe
					// here (idempotent); the map update happens below in
					// THIS goroutine (never via the unregister channel —
					// Run must not send to itself).
					c.CloseOnce()
					dropped = append(dropped, c)
				}
			}
			if len(dropped) > 0 {
				h.mu.Lock()
				for _, c := range dropped {
					delete(h.clients, c)
				}
				h.mu.Unlock()
			}
		case <-h.done:
			return
		}
	}
}

// Stop terminates Run. Idempotent.
func (h *Hub) Stop() {
	h.once.Do(func() { close(h.done) })
}

// Register enqueues a client for membership. It returns immediately; the
// client becomes a broadcast target once Run processes the transition.
func (h *Hub) Register(c *Client) {
	h.register <- c
}

// drop removes a client from membership and closes its send channel. Safe
// to call from any goroutine EXCEPT inside Run's own loop (Run unregisters
// slow clients inline to avoid sending on its own channel).
func (h *Hub) drop(c *Client) {
	c.CloseOnce()
	h.unregister <- c
}

// Unregister removes a client (normal disconnect path).
func (h *Hub) Unregister(c *Client) {
	h.drop(c)
}

// Broadcast enqueues msg for every registered client. Non-blocking on the
// caller side (channel capacity absorbs bursts); per-client delivery is
// governed by the slow-client policy inside Run.
func (h *Hub) Broadcast(payload []byte) {
	select {
	case h.broadcastC <- message{payload: payload}:
	default:
		// Hub queue full: the burst exceeds the fan-out capacity. Dropping
		// the broadcast frame is the documented policy (never block REST
		// handlers on the hub).
	}
}

// Count returns the current membership size (for metrics/tests).
func (h *Hub) Count() int {
	h.mu.RLock()
	defer h.mu.RUnlock()
	return len(h.clients)
}

// SendBufferSize exposes the configured per-client queue capacity.
func (h *Hub) SendBufferSize() int { return h.cfg.SendBuffer }

// Config exposes the hub configuration (tests/metrics).
func (h *Hub) Config() Config { return h.cfg }

// NewClient creates a client bound to this hub (upgrade path helper).
func (h *Hub) NewClient(email string) *Client {
	return &Client{Email: email, Send: make(chan []byte, h.cfg.SendBuffer), hub: h}
}
