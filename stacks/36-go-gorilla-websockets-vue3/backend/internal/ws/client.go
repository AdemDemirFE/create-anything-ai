// client.go — per-connection pump goroutines (the gorilla pattern, written
// out by hand instead of hidden behind a framework):
//
//   - readPump is the ONLY reader of the conn. It enforces PongWait as the
//     read deadline (extended on every PONG/data frame), surfaces inbound
//     messages to the hub's listener, and exits on any error.
//   - writePump is the ONLY writer to the conn. It drains the buffered send
//     channel, enforces WriteWait per write, and sends keepalive PINGs on
//     PingPeriod. PONGs from the peer keep readPump alive.
package ws

import (
	"time"

	"github.com/gorilla/websocket"
)

// InboundHandler receives one text message from a client. Called on the
// client's reader goroutine; implementations must not block.
type InboundHandler func(c *Client, payload []byte)

// CloseHandler is invoked once when the client's read loop terminates
// (network error, close frame, or pong timeout).
type CloseHandler func(c *Client)

// Pumps bundles the callbacks the connection pumps need.
type Pumps struct {
	OnMessage InboundHandler
	OnClose   CloseHandler
}

// ServeClient wires one upgraded conn into the hub: registers the client,
// starts the write pump, and unregisters on exit. It blocks until the read
// loop ends, so callers run it in its own goroutine.
func ServeClient(h *Hub, c *Client, conn *websocket.Conn, pumps Pumps) {
	h.Register(c)
	defer func() {
		h.Unregister(c)
		if pumps.OnClose != nil {
			pumps.OnClose(c)
		}
	}()

	go writePump(h, c, conn)

	readPump(h, c, conn, pumps)
	// readPump exited: tear the write side down too.
	c.CloseOnce()
}

// readPump reads until the connection dies. The read deadline is set to
// PongWait and extended on every received frame; the pong handler resets it
// when the peer answers our PINGs.
func readPump(h *Hub, c *Client, conn *websocket.Conn, pumps Pumps) {
	defer func() {
		_ = conn.Close()
	}()

	if h.cfg.PongWait > 0 {
		_ = conn.SetReadDeadline(time.Now().Add(h.cfg.PongWait))
		conn.SetPongHandler(func(string) error {
			return conn.SetReadDeadline(time.Now().Add(h.cfg.PongWait))
		})
	}

	for {
		_, payload, err := conn.ReadMessage()
		if err != nil {
			return // normal disconnect, close frame, or pong timeout
		}
		if pumps.OnMessage != nil {
			pumps.OnMessage(c, payload)
		}
	}
}

// writePump drains the send channel and emits keepalive PINGs. It is the
// single writer to the connection. Every data write carries the WriteWait
// deadline, so a stalled TCP peer fails the write instead of leaking the
// goroutine — that failure is the deadline half of the slow-client policy.
func writePump(h *Hub, c *Client, conn *websocket.Conn) {
	ticker := time.NewTicker(h.cfg.PingPeriod)
	defer func() {
		ticker.Stop()
		_ = conn.Close()
	}()

	for {
		select {
		case msg, ok := <-c.Send:
			_ = conn.SetWriteDeadline(time.Now().Add(h.cfg.WriteWait))
			if !ok {
				// Hub closed our channel (drop or shutdown): say goodbye
				// and exit so the conn closes.
				_ = conn.WriteMessage(websocket.CloseMessage, []byte{})
				return
			}
			if err := conn.WriteMessage(websocket.TextMessage, msg); err != nil {
				return
			}
		case <-ticker.C:
			_ = conn.SetWriteDeadline(time.Now().Add(h.cfg.WriteWait))
			if err := conn.WriteMessage(websocket.PingMessage, nil); err != nil {
				return
			}
		}
	}
}
