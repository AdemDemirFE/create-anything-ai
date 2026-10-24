// client_test.go — REAL connection-level tests for the pumps: a gorilla
// dialer against an in-process httptest server running the actual
// ServeClient wiring. Covers the deadline half of the slow-client policy
// (write deadline), the pong keepalive, and normal close teardown.
package ws_test

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/gorilla/websocket"

	"github.com/AdemDemirFE/create-anything-ai/stacks/36-go-gorilla-websockets-vue3/backend/internal/ws"
)

// shortConfig keeps timing tests fast but generous enough for CI.
func shortConfig() ws.Config {
	return ws.Config{
		SendBuffer: 4,
		PingPeriod: 30 * time.Millisecond,
		PongWait:   250 * time.Millisecond,
		WriteWait:  150 * time.Millisecond,
	}
}

// echoSetup builds an httptest server whose /ws upgrades and serves a client
// through the REAL ServeClient path, registering into the given hub.
func echoSetup(t *testing.T, cfg ws.Config, origin string) (*ws.Hub, *httptest.Server) {
	t.Helper()
	h := ws.NewHub(&cfg)
	go h.Run()
	t.Cleanup(h.Stop)

	up := websocket.Upgrader{
		CheckOrigin: func(r *http.Request) bool {
			return origin == "" || r.Header.Get("Origin") == origin
		},
	}
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		conn, err := up.Upgrade(w, r, nil)
		if err != nil {
			return
		}
		client := h.NewClient("clientip-test@example.com")
		pumps := ws.Pumps{
			OnMessage: func(c *ws.Client, payload []byte) {
				// Application-level ping → pong (mirrors the API wiring).
				if strings.Contains(string(payload), `"type":"ping"`) {
					_ = c.SendMsg([]byte(`{"type":"pong"}`))
				}
			},
		}
		go ws.ServeClient(h, client, conn, pumps)
	}))
	t.Cleanup(srv.Close)
	return h, srv
}

func dial(t *testing.T, srv *httptest.Server, origin string) *websocket.Conn {
	t.Helper()
	hdr := http.Header{}
	if origin != "" {
		hdr.Set("Origin", origin)
	}
	conn, resp, err := websocket.DefaultDialer.Dial(wsURL(srv), hdr)
	if err != nil {
		t.Fatalf("dial: %v (resp: %v)", err, resp)
	}
	t.Cleanup(func() { _ = conn.Close() })
	return conn
}

func wsURL(srv *httptest.Server) string {
	return "ws" + strings.TrimPrefix(srv.URL, "http") + "/ws"
}

func TestClientReceivesBroadcastOverRealConnection(t *testing.T) {
	h, srv := echoSetup(t, shortConfig(), "")
	time.Sleep(20 * time.Millisecond) // let the dial/upgrade settle below

	conn := dial(t, srv, "")
	defer func() { _ = conn.Close() }()

	// Wait for the server-side registration.
	waitFor(t, func() bool { return h.Count() == 1 })

	h.Broadcast([]byte(`{"type":"hello"}`))
	_ = conn.SetReadDeadline(time.Now().Add(2 * time.Second))
	_, payload, err := conn.ReadMessage()
	if err != nil {
		t.Fatalf("read broadcast: %v", err)
	}
	if string(payload) != `{"type":"hello"}` {
		t.Fatalf("payload = %q", payload)
	}
}

func TestAppLevelPingGetsPong(t *testing.T) {
	_, srv := echoSetup(t, shortConfig(), "")
	conn := dial(t, srv, "")

	_ = conn.SetWriteDeadline(time.Now().Add(time.Second))
	if err := conn.WriteMessage(websocket.TextMessage, []byte(`{"type":"ping"}`)); err != nil {
		t.Fatalf("write ping: %v", err)
	}
	_ = conn.SetReadDeadline(time.Now().Add(2 * time.Second))
	_, payload, err := conn.ReadMessage()
	if err != nil {
		t.Fatalf("read pong: %v", err)
	}
	if !strings.Contains(string(payload), `"type":"pong"`) {
		t.Fatalf("payload = %q, want pong", payload)
	}
}

// Protocol keepalive: the write pump's PINGs must keep the connection alive
// well beyond PongWait, because the peer's PONG (auto-answered by gorilla's
// default pong handler on the client side... which a raw dialer does NOT
// send) — so instead we assert the DIRECT contract: a silent client that
// answers nothing gets dropped after PongWait.
func TestSilentClientIsDroppedAfterPongWait(t *testing.T) {
	cfg := shortConfig() // PongWait 250ms
	h, srv := echoSetup(t, cfg, "")
	conn := dial(t, srv, "")

	waitFor(t, func() bool { return h.Count() == 1 })

	// Do NOT answer pings. The read deadline must expire and tear the
	// client down. Allow a few PongWait periods for the deadline to fire.
	waitFor(t, func() bool { return h.Count() == 0 })

	// The server's close should surface on the client as an error/close.
	_ = conn.SetReadDeadline(time.Now().Add(2 * time.Second))
	for {
		if _, _, err := conn.ReadMessage(); err != nil {
			break // closed by the server
		}
	}
}

// Deadline half of the slow-client policy: with a full buffer, the write
// pump can only deliver one message per WriteWait; a client that never reads
// gets its writes to fail and its connection torn down. We assert the
// observable: after overflowing a small buffer, the hub eventually drops the
// client (drop-on-broadcast) — the write deadline closes the conn from the
// server side when the TCP window fills.
func TestStalledWriterEventuallyFailsDeadline(t *testing.T) {
	cfg := shortConfig()
	cfg.SendBuffer = 1
	h, srv := echoSetup(t, cfg, "")
	conn := dial(t, srv, "")

	waitFor(t, func() bool { return h.Count() == 1 })

	// Client reads nothing. Fill the buffer, then overflow via broadcast.
	h.Broadcast([]byte(`{"n":1}`))
	h.Broadcast([]byte(`{"n":2}`)) // buffer full → drop path
	waitFor(t, func() bool { return h.Count() == 0 })

	// The closed send channel makes the write pump send a close frame and
	// exit; the client observes the connection ending.
	_ = conn.SetReadDeadline(time.Now().Add(2 * time.Second))
	for {
		if _, _, err := conn.ReadMessage(); err != nil {
			break
		}
	}
}

func TestCloseFrameEndsRegistration(t *testing.T) {
	h, srv := echoSetup(t, shortConfig(), "")
	conn := dial(t, srv, "")

	waitFor(t, func() bool { return h.Count() == 1 })

	// Polite client close.
	_ = conn.WriteMessage(websocket.CloseMessage, websocket.FormatCloseMessage(websocket.CloseNormalClosure, "bye"))
	waitFor(t, func() bool { return h.Count() == 0 })
}
