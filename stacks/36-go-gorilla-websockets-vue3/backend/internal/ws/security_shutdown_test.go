// security_shutdown_test.go — regression tests for the two review findings:
//
//  1. Read limit: an authenticated client must NOT be able to push
//     arbitrarily large frames into server memory. A frame over
//     Config.MaxMessageSize fails the read loop and tears the connection
//     down (real gorilla dialer against the real ServeClient wiring).
//  2. Shutdown: Register/Unregister/Broadcast after (or racing with) Stop
//     must return immediately — no goroutine leak from callers parked on
//     hub channels forever. runtime.NumGoroutine pins the count.
package ws_test

import (
	"net/http"
	"net/http/httptest"
	"runtime"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/gorilla/websocket"

	"github.com/AdemDemirFE/create-anything-ai/stacks/36-go-gorilla-websockets-vue3/backend/internal/ws"
)

// --- Finding 1: SetReadLimit -------------------------------------------------

func limitedSetup(t *testing.T, cfg ws.Config) (*ws.Hub, *httptest.Server) {
	t.Helper()
	h := ws.NewHub(&cfg)
	go h.Run()
	t.Cleanup(h.Stop)

	up := websocket.Upgrader{}
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		conn, err := up.Upgrade(w, r, nil)
		if err != nil {
			return
		}
		client := h.NewClient("limit-test@example.com")
		pumps := ws.Pumps{
			OnMessage: func(c *ws.Client, payload []byte) {
				_ = c.SendMsg([]byte(`{"type":"pong"}`))
			},
		}
		go ws.ServeClient(h, client, conn, pumps)
	}))
	t.Cleanup(srv.Close)
	return h, srv
}

// A frame within the limit is delivered to OnMessage; the same connection
// then sends an OVERSIZED frame and the server MUST close the connection.
func TestOversizedFrameClosesConnection(t *testing.T) {
	cfg := ws.DefaultConfig()
	cfg.MaxMessageSize = 512
	cfg.PongWait = 5 * time.Second // keepalive off the critical path
	h, srv := limitedSetup(t, cfg)

	conn := dial(t, srv, "")
	waitFor(t, func() bool { return h.Count() == 1 })

	// Within the limit → delivered.
	small := `{"type":"ping"}`
	if err := conn.WriteMessage(websocket.TextMessage, []byte(small)); err != nil {
		t.Fatalf("write small frame: %v", err)
	}
	_ = conn.SetReadDeadline(time.Now().Add(2 * time.Second))
	_, payload, err := conn.ReadMessage()
	if err != nil {
		t.Fatalf("read pong: %v", err)
	}
	if string(payload) != `{"type":"pong"}` {
		t.Fatalf("payload = %q", payload)
	}

	// Over the limit → the server tears the connection down.
	big := `{"type":"ping","pad":"` + strings.Repeat("x", 1024) + `"}`
	if err := conn.WriteMessage(websocket.TextMessage, []byte(big)); err != nil {
		t.Fatalf("write oversized frame: %v", err)
	}

	// The read loop failed with a read-limit error → client unregistered
	// and connection closed. The next read on the client must fail.
	_ = conn.SetReadDeadline(time.Now().Add(2 * time.Second))
	for {
		if _, _, err := conn.ReadMessage(); err != nil {
			break
		}
	}
	waitFor(t, func() bool { return h.Count() == 0 })
}

// A frame exactly at the limit must still be accepted (boundary).
func TestFrameAtLimitIsAccepted(t *testing.T) {
	cfg := ws.DefaultConfig()
	cfg.MaxMessageSize = 512
	cfg.PongWait = 5 * time.Second
	h, srv := limitedSetup(t, cfg)

	conn := dial(t, srv, "")
	waitFor(t, func() bool { return h.Count() == 1 })

	// At the cap (gorilla's ReadLimit includes the whole frame payload).
	frame := `{"pad":"` + strings.Repeat("x", 512-10) + `"}`
	if len(frame) != 512 {
		t.Fatalf("test frame size = %d, want 512", len(frame))
	}
	if err := conn.WriteMessage(websocket.TextMessage, []byte(frame)); err != nil {
		t.Fatalf("write at-limit frame: %v", err)
	}
	_ = conn.SetReadDeadline(time.Now().Add(2 * time.Second))
	if _, _, err := conn.ReadMessage(); err != nil {
		t.Fatalf("pong after at-limit frame: %v", err)
	}
	waitFor(t, func() bool { return h.Count() == 1 }) // still connected
}

// --- Finding 2: shutdown does not leak goroutines -----------------------------

// After Stop, Register/Unregister/Broadcast return immediately (no parked
// senders) and the hub goroutine has exited. Membership semantics after
// Stop: the map is frozen (Run has exited); Count may still show whatever
// was registered at shutdown — the IMPORTANT contract is that no caller
// blocks and the hub loop is gone.
func TestPostStopCallsReturnImmediately(t *testing.T) {
	h, stop := startHub(t, nil)

	c := h.NewClient("pre@example.com")
	h.Register(c)
	waitFor(t, func() bool { return h.Count() == 1 })

	stop() // closes Run AND the entry channels

	if h.Register(h.NewClient("post@example.com")) {
		t.Fatalf("Register after Stop must return false")
	}
	if h.Unregister(c) {
		t.Fatalf("Unregister after Stop must return false")
	}
	h.Broadcast([]byte(`{"after":"stop"}`)) // must not block or panic
}

// The critical leak scenario: callers parked on Register/Unregister when
// Stop fires must be RELEASED by Stop (done close), not parked forever.
// We park senders in a goroutine each, then Stop, then assert they all
// returned. Without the select-on-done guards this test times out.
func TestStopReleasesParkedSenders(t *testing.T) {
	h, stop := startHub(t, nil)

	// Park senders on each entry point (the unbuffered register/unregister
	// channels park the send until Run reads it — or until the done guard
	// releases it).
	var parked sync.WaitGroup
	park := func(fn func()) {
		parked.Add(1)
		go func() {
			defer parked.Done()
			fn()
		}()
	}
	park(func() { h.Register(h.NewClient("p1@example.com")) })
	park(func() { h.Register(h.NewClient("p2@example.com")) })
	time.Sleep(20 * time.Millisecond) // let them park on the channels

	stop()
	parked.Wait() // every parked sender returned
}

// Goroutine count must return to the pre-hub baseline after Stop: no hub
// loop, no parked senders, no leaked upgrade goroutines.
func TestGoroutineCountStableAcrossHubCycles(t *testing.T) {
	runtime.GC()
	time.Sleep(50 * time.Millisecond)
	before := runtime.NumGoroutine()

	for i := 0; i < 5; i++ {
		h, stop := startHub(t, nil)
		c := h.NewClient("cycle@example.com")
		h.Register(c)
		waitFor(t, func() bool { return h.Count() == 1 })
		h.Broadcast([]byte(`{"n":1}`))
		stop()
	}

	runtime.GC()
	time.Sleep(100 * time.Millisecond)
	deadline := time.Now().Add(2 * time.Second)
	var after int
	for {
		after = runtime.NumGoroutine()
		if after <= before {
			break
		}
		if time.Now().After(deadline) {
			t.Fatalf("goroutine leak: before=%d after=%d", before, after)
		}
		time.Sleep(20 * time.Millisecond)
	}
}

// Stop is idempotent and racing Stops do not panic.
func TestStopIsIdempotentAndRaceSafe(t *testing.T) {
	_, stop := startHub(t, nil)
	done := make(chan struct{})
	for i := 0; i < 4; i++ {
		go func() {
			defer func() { done <- struct{}{} }()
			stop()
		}()
	}
	for i := 0; i < 4; i++ {
		select {
		case <-done:
		case <-time.After(2 * time.Second):
			t.Fatalf("concurrent Stop hung")
		}
	}
}
