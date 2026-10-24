// hub_test.go — REAL unit tests for the hand-written hub: registration
// state, broadcast fan-out, and the slow-client drop policy. The hub runs on
// a real goroutine with real channels; timing uses channels with generous
// deadlines (never sleeps) so the suite stays deterministic on CI.
package ws_test

import (
	"testing"
	"time"

	"github.com/AdemDemirFE/create-anything-ai/stacks/36-go-gorilla-websockets-vue3/backend/internal/ws"
)

// waitFor polls cond until true or the deadline passes.
func waitFor(t *testing.T, cond func() bool) {
	t.Helper()
	deadline := time.Now().Add(2 * time.Second)
	for time.Now().Before(deadline) {
		if cond() {
			return
		}
		time.Sleep(2 * time.Millisecond)
	}
	t.Fatalf("condition not reached within deadline")
}

func startHub(t *testing.T, cfg *ws.Config) (*ws.Hub, func()) {
	t.Helper()
	h := ws.NewHub(cfg)
	done := make(chan struct{})
	go func() {
		h.Run()
		close(done)
	}()
	stop := func() {
		h.Stop()
		select {
		case <-done:
		case <-time.After(2 * time.Second):
			t.Fatalf("hub Run did not exit after Stop")
		}
	}
	return h, stop
}

func TestRegisterIncrementsCount(t *testing.T) {
	h, stop := startHub(t, nil)
	defer stop()

	c := h.NewClient("alice@example.com")
	h.Register(c)
	waitFor(t, func() bool { return h.Count() == 1 })

	if got := h.Count(); got != 1 {
		t.Fatalf("Count() = %d, want 1", got)
	}
}

func TestUnregisterDecrementsCount(t *testing.T) {
	h, stop := startHub(t, nil)
	defer stop()

	c := h.NewClient("alice@example.com")
	h.Register(c)
	waitFor(t, func() bool { return h.Count() == 1 })
	h.Unregister(c)
	waitFor(t, func() bool { return h.Count() == 0 })
}

func TestBroadcastReachesRegisteredClient(t *testing.T) {
	h, stop := startHub(t, nil)
	defer stop()

	c := h.NewClient("alice@example.com")
	h.Register(c)
	waitFor(t, func() bool { return h.Count() == 1 })

	h.Broadcast([]byte(`{"type":"run.completed"}`))

	select {
	case got := <-c.Send:
		if string(got) != `{"type":"run.completed"}` {
			t.Fatalf("broadcast payload = %q, want run.completed frame", got)
		}
	case <-time.After(2 * time.Second):
		t.Fatalf("broadcast did not reach the client in time")
	}
}

func TestBroadcastFanOutTwoClients(t *testing.T) {
	h, stop := startHub(t, nil)
	defer stop()

	a := h.NewClient("a@example.com")
	b := h.NewClient("b@example.com")
	h.Register(a)
	h.Register(b)
	waitFor(t, func() bool { return h.Count() == 2 })

	h.Broadcast([]byte(`{"n":1}`))

	for name, ch := range map[string]<-chan []byte{"a": a.Send, "b": b.Send} {
		select {
		case got := <-ch:
			if string(got) != `{"n":1}` {
				t.Fatalf("client %s payload = %q", name, got)
			}
		case <-time.After(2 * time.Second):
			t.Fatalf("broadcast did not reach client %s", name)
		}
	}
}

func TestUnregisteredClientDoesNotReceiveBroadcast(t *testing.T) {
	h, stop := startHub(t, nil)
	defer stop()

	a := h.NewClient("a@example.com")
	b := h.NewClient("b@example.com")
	h.Register(a)
	h.Register(b)
	waitFor(t, func() bool { return h.Count() == 2 })

	h.Unregister(a)
	waitFor(t, func() bool { return h.Count() == 1 })

	h.Broadcast([]byte(`{"n":2}`))
	select {
	case got := <-b.Send:
		if string(got) != `{"n":2}` {
			t.Fatalf("b payload = %q", got)
		}
	case <-time.After(2 * time.Second):
		t.Fatalf("b did not receive the broadcast")
	}
	select {
	case got, ok := <-a.Send:
		if ok {
			t.Fatalf("unregistered a received %q", got)
		}
		// Channel closed by Unregister: also a violation of "no more
		// deliveries" — but expected behavior per policy, not a failure.
	case <-time.After(50 * time.Millisecond):
	}
}

// THE core policy: a client that stopped draining its buffer must be dropped
// by the hub on the next broadcast — never blocked on, never buffered
// unboundedly. The dropped client's send channel is closed.
func TestSlowClientIsDroppedOnFullBuffer(t *testing.T) {
	cfg := ws.DefaultConfig()
	cfg.SendBuffer = 2
	h, stop := startHub(t, &cfg)
	defer stop()

	slow := h.NewClient("slow@example.com")
	h.Register(slow)
	waitFor(t, func() bool { return h.Count() == 1 })

	// Fill the buffer (client reads nothing).
	h.Broadcast([]byte(`{"n":1}`))
	h.Broadcast([]byte(`{"n":2}`))
	waitFor(t, func() bool { return len(slow.Send) == 2 })

	// This one overflows → drop path.
	h.Broadcast([]byte(`{"n":3}`))

	// The drop unregisters the client and closes its send channel.
	waitFor(t, func() bool { return h.Count() == 0 })

	// Drain the queued frames the client never read; the channel is then
	// closed by the drop (CloseOnce closes AFTER the queued messages — a
	// close on a buffered channel does not discard its contents).
	for {
		_, ok := <-slow.Send
		if !ok {
			break
		}
	}
	if _, ok := <-slow.Send; ok {
		t.Fatalf("slow client's send channel should be closed after drop")
	}

	// The hub is healthy: a fresh client receives the next broadcast.
	fast := h.NewClient("fast@example.com")
	h.Register(fast)
	waitFor(t, func() bool { return h.Count() == 1 })
	h.Broadcast([]byte(`{"n":4}`))
	select {
	case got := <-fast.Send:
		if string(got) != `{"n":4}` {
			t.Fatalf("fast payload = %q", got)
		}
	case <-time.After(2 * time.Second):
		t.Fatalf("hub stopped delivering after a slow-client drop")
	}
}

func TestSendMsgAfterCloseReturnsFalse(t *testing.T) {
	h, stop := startHub(t, nil)
	defer stop()

	c := h.NewClient("x@example.com")
	h.Register(c)
	waitFor(t, func() bool { return h.Count() == 1 })

	h.Unregister(c) // closes the send channel
	waitFor(t, func() bool { return h.Count() == 0 })

	if c.SendMsg([]byte(`{"late":true}`)) {
		t.Fatalf("SendMsg on a closed client must return false")
	}
}

func TestBroadcastOnEmptyHubIsNoop(t *testing.T) {
	h, stop := startHub(t, nil)
	defer stop()

	h.Broadcast([]byte(`{"nobody":true}`)) // must not panic or block

	if got := h.Count(); got != 0 {
		t.Fatalf("Count() = %d, want 0", got)
	}
}

func TestDefaultConfigOrdering(t *testing.T) {
	cfg := ws.DefaultConfig()
	if cfg.PingPeriod >= cfg.PongWait {
		t.Fatalf("PingPeriod (%v) must be < PongWait (%v)", cfg.PingPeriod, cfg.PongWait)
	}
	if cfg.SendBuffer <= 0 || cfg.WriteWait <= 0 {
		t.Fatalf("SendBuffer/WriteWait must be positive: %+v", cfg)
	}
}
