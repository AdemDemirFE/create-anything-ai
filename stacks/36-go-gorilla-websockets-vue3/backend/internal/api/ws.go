// ws.go — the /ws upgrade endpoint: the seam where net/http hands a raw TCP
// stream to gorilla/websocket and the connection is wired into the
// hand-rolled hub.
//
// Upgrade order (each step rejects BEFORE any state is created):
//  1. RequireSession middleware has already resolved the cookie → 401.
//  2. Origin check (CrossOriginWSRF): gorilla's Upgrader.CheckOrigin is the
//     single decision point; we delegate to the configured OriginChecker —
//     the browser SameSite policy does NOT protect a WS handshake, so the
//     Origin header must match the allowlist or the handshake gets 403.
//  3. gorilla Upgrader performs the RFC 6455 handshake (Sec-WebSocket-Key /
//     Sec-WebSocket-Accept, 101 Switching Protocols).
//  4. A Client (buffered send channel) is created and served: register →
//     readPump/writePump → unregister on exit.
//
// Inbound protocol (deliberately tiny, echo-free): a client may send
// {"type":"ping"} to request {"type":"pong","ts":...} — an application-level
// keepalive MIRRORING the protocol-level ping/pong the pumps run. Anything
// else is ignored (no user content is ever fanned back out unvalidated).
package api

import (
	"encoding/json"
	"log"
	"net/http"
	"time"

	"github.com/gorilla/websocket"

	"github.com/AdemDemirFE/create-anything-ai/stacks/36-go-gorilla-websockets-vue3/backend/internal/algorithm"
	"github.com/AdemDemirFE/create-anything-ai/stacks/36-go-gorilla-websockets-vue3/backend/internal/ws"
)

// Upgrader builds the gorilla Upgrader with the CrossOriginWSRF policy wired
// into CheckOrigin. Buffer sizes are gorilla's documented defaults made
// explicit.
func Upgrader(origin *ws.OriginChecker) websocket.Upgrader {
	return websocket.Upgrader{
		ReadBufferSize:  4096,
		WriteBufferSize: 4096,
		CheckOrigin: func(r *http.Request) bool {
			return origin.Check(r.Header.Get("Origin"))
		},
		// Subprotocols: none negotiated — the app protocol is plain JSON
		// text frames, declared here for documentation.
	}
}

// inboundMessage is the only client-to-server frame the app understands.
type inboundMessage struct {
	Type string `json:"type"`
}

// outboundMessage is the server-to-client broadcast/event frame. The
// run.completed shape mirrors Stack 35's runEvent (type/algorithm id/
// execution_ms/complexity) so the two realtime stacks stay comparable at the
// UI level.
type outboundMessage struct {
	Type        string   `json:"type"`
	Email       string   `json:"email,omitempty"`
	AlgorithmID string   `json:"algorithm_id,omitempty"`
	ExecutionMS *float64 `json:"execution_ms,omitempty"`
	Complexity  string   `json:"complexity,omitempty"`
	OccurredAt  string   `json:"occurred_at,omitempty"`
	Clients     int      `json:"clients,omitempty"`
	TS          string   `json:"ts,omitempty"`
}

// ServeWS upgrades and serves one WebSocket connection. It requires
// RequireSession in the chain (the email comes from the request context).
func (h *Handlers) ServeWS(w http.ResponseWriter, r *http.Request, up *websocket.Upgrader, hub *ws.Hub) {
	email := EmailFrom(r.Context())

	conn, err := up.Upgrade(w, r, nil)
	if err != nil {
		// Upgrade already wrote the HTTP error (403 origin, 400 handshake).
		return
	}

	client := hub.NewClient(email)

	pumps := ws.Pumps{
		OnMessage: func(c *ws.Client, payload []byte) {
			var in inboundMessage
			if err := json.Unmarshal(payload, &in); err != nil {
				return // malformed frame: ignored, never echoed
			}
			if in.Type == "ping" {
				out, _ := json.Marshal(outboundMessage{Type: "pong", TS: time.Now().UTC().Format(time.RFC3339Nano)})
				// Application pong is best-effort; a full buffer drops the
				// client per the slow-client policy (Send returns false; the
				// hub's drop path closes in on the next broadcast).
				_ = c.SendMsg(out)
			}
		},
	}

	go ws.ServeClient(hub, client, conn, pumps)
}

// HubBroadcaster adapts the hand-written hub to the RunPublisher seam.
type HubBroadcaster struct {
	Hub *ws.Hub
}

// PublishRun fans a completed algorithm run out to every connected client.
func (b *HubBroadcaster) PublishRun(email string, result algorithm.RunResult) {
	rounded := float64(int(result.ExecutionMS*10+0.5)) / 10
	msg := outboundMessage{
		Type:        "run.completed",
		Email:       email,
		AlgorithmID: result.AlgorithmID,
		ExecutionMS: &rounded,
		Complexity:  result.Complexity,
		OccurredAt:  time.Now().UTC().Format(time.RFC3339),
	}
	payload, err := json.Marshal(msg)
	if err != nil {
		log.Printf("ws: marshal run event: %v", err)
		return
	}
	b.Hub.Broadcast(payload)
}
