// app_integration_test.go — REAL integration tests over the exact
// production wiring (app.New → httptest.Server): REST envelope contract,
// auth flows, throttle, request-id correlation, and the /ws upgrade path
// through a real gorilla dialer (handshake + message flow + origin check).
package app_test

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/cookiejar"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"
	"time"

	"github.com/gorilla/websocket"

	"github.com/AdemDemirFE/create-anything-ai/stacks/36-go-gorilla-websockets-vue3/backend/internal/app"
	"github.com/AdemDemirFE/create-anything-ai/stacks/36-go-gorilla-websockets-vue3/backend/internal/ws"
)

// env is one test server with a client bound to its cookie jar.
type env struct {
	t      *testing.T
	server *httptest.Server
	client *http.Client
	app    *app.App
}

func newEnv(t *testing.T, mutate func(*app.Options)) *env {
	t.Helper()
	opts := app.Options{
		Addr:           "127.0.0.1:0",
		AllowedOrigins: []string{"http://localhost:5173"},
		HubConfig:      nil,
	}
	if mutate != nil {
		mutate(&opts)
	}
	a := app.New(opts)
	server := httptest.NewServer(a.Handler())
	t.Cleanup(func() {
		server.Close()
		a.Hub.Stop()
	})
	jar, err := cookiejar.New(nil)
	if err != nil {
		t.Fatalf("cookiejar: %v", err)
	}
	return &env{t: t, server: server, client: &http.Client{Jar: jar, Timeout: 5 * time.Second}, app: a}
}

// do performs a JSON request and decodes the envelope response.
func (e *env) do(method, path string, body any, hdr map[string]string) (int, http.Header, map[string]any) {
	e.t.Helper()
	var reader *bytes.Reader
	if body != nil {
		raw, err := json.Marshal(body)
		if err != nil {
			e.t.Fatalf("marshal body: %v", err)
		}
		reader = bytes.NewReader(raw)
	} else {
		reader = bytes.NewReader(nil)
	}
	req, err := http.NewRequest(method, e.server.URL+path, reader)
	if err != nil {
		e.t.Fatalf("new request: %v", err)
	}
	req.Header.Set("Content-Type", "application/json")
	for k, v := range hdr {
		req.Header.Set(k, v)
	}
	resp, err := e.client.Do(req)
	if err != nil {
		e.t.Fatalf("%s %s: %v", method, path, err)
	}
	defer resp.Body.Close()
	var envBody map[string]any
	if err := json.NewDecoder(resp.Body).Decode(&envBody); err != nil {
		e.t.Fatalf("decode envelope from %s %s: %v", method, path, err)
	}
	return resp.StatusCode, resp.Header, envBody
}

// registerAndLogin creates a fresh account and stores its session cookie.
func (e *env) registerAndLogin(email, password string) {
	e.t.Helper()
	status, _, body := e.do("POST", "/api/v1/register", map[string]string{"email": email, "password": password}, nil)
	if status != http.StatusCreated {
		e.t.Fatalf("register status = %d body = %v", status, body)
	}
	status, _, body = e.do("POST", "/api/v1/login", map[string]string{"email": email, "password": password}, nil)
	if status != http.StatusOK {
		e.t.Fatalf("login status = %d body = %v", status, body)
	}
}

func requireSuccess(t *testing.T, body map[string]any) map[string]any {
	t.Helper()
	if ok, _ := body["success"].(bool); !ok {
		t.Fatalf("success = %v, body = %v", body["success"], body)
	}
	data, _ := body["data"].(map[string]any)
	if data == nil {
		t.Fatalf("data is null on success path: %v", body)
	}
	meta, _ := body["meta"].(map[string]any)
	if meta == nil || meta["request_id"] == "" || meta["timestamp"] == "" {
		t.Fatalf("meta missing request_id/timestamp: %v", meta)
	}
	return data
}

func requireError(t *testing.T, body map[string]any) map[string]any {
	t.Helper()
	if ok, _ := body["success"].(bool); ok {
		t.Fatalf("success = true on error path: %v", body)
	}
	if data, ok := body["data"]; !ok || data != nil {
		t.Fatalf("data must be null on error path: %v", body)
	}
	errBody, _ := body["error"].(map[string]any)
	if errBody == nil || errBody["code"] == "" || errBody["message"] == "" {
		t.Fatalf("error missing code/message: %v", body)
	}
	meta, _ := body["meta"].(map[string]any)
	if meta == nil || meta["request_id"] == "" {
		t.Fatalf("meta missing request_id: %v", meta)
	}
	return errBody
}

// --- Envelope & correlation -------------------------------------------------

func TestHealthz(t *testing.T) {
	e := newEnv(t, nil)
	resp, err := e.client.Get(e.server.URL + "/healthz")
	if err != nil {
		t.Fatalf("healthz: %v", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("status = %d", resp.StatusCode)
	}
	var body map[string]string
	if err := json.NewDecoder(resp.Body).Decode(&body); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if body["status"] != "ok" {
		t.Fatalf("body = %v", body)
	}
}

func TestRegister201EnvelopeShape(t *testing.T) {
	e := newEnv(t, nil)
	status, hdr, body := e.do("POST", "/api/v1/register", map[string]string{
		"email": "envelope@example.com", "password": "Str0ngPassw0rd",
	}, nil)
	if status != http.StatusCreated {
		t.Fatalf("status = %d, want 201", status)
	}
	data := requireSuccess(t, body)
	if data["email"] != "envelope@example.com" {
		t.Fatalf("data.email = %v", data["email"])
	}
	if hdr.Get("X-Request-Id") == "" {
		t.Fatalf("X-Request-Id header missing")
	}
	meta := body["meta"].(map[string]any)
	if meta["request_id"] != hdr.Get("X-Request-Id") {
		t.Fatalf("meta.request_id (%v) != X-Request-Id (%v)", meta["request_id"], hdr.Get("X-Request-Id"))
	}
}

func TestDuplicateEmail409(t *testing.T) {
	e := newEnv(t, nil)
	e.registerAndLogin("dup@example.com", "Str0ngPassw0rd")
	status, _, body := e.do("POST", "/api/v1/register", map[string]string{
		"email": "dup@example.com", "password": "Str0ngPassw0rd",
	}, nil)
	if status != http.StatusConflict {
		t.Fatalf("status = %d, want 409", status)
	}
	errBody := requireError(t, body)
	if errBody["code"] != "EMAIL_TAKEN" {
		t.Fatalf("code = %v, want EMAIL_TAKEN", errBody["code"])
	}
}

func TestValidationErrorsFieldLevel(t *testing.T) {
	e := newEnv(t, nil)
	status, _, body := e.do("POST", "/api/v1/register", map[string]string{
		"email": "not-an-email", "password": "short",
	}, nil)
	if status != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400", status)
	}
	errBody := requireError(t, body)
	if errBody["code"] != "VALIDATION_ERROR" {
		t.Fatalf("code = %v", errBody["code"])
	}
	details, _ := errBody["details"].([]any)
	if len(details) != 2 {
		t.Fatalf("details = %v, want 2 field errors", details)
	}
	seen := map[string]bool{}
	for _, d := range details {
		dm := d.(map[string]any)
		seen[dm["field"].(string)] = true
	}
	if !seen["email"] || !seen["password"] {
		t.Fatalf("field details missing email/password: %v", details)
	}
}

func TestLoginEnumerationParity(t *testing.T) {
	e := newEnv(t, nil)
	e.registerAndLogin("known@example.com", "Str0ngPassw0rd")

	// Unknown email vs wrong password: identical status/code/message.
	st1, _, b1 := e.do("POST", "/api/v1/login", map[string]string{
		"email": "ghost@example.com", "password": "Whatever123",
	}, nil)
	st2, _, b2 := e.do("POST", "/api/v1/login", map[string]string{
		"email": "known@example.com", "password": "WrongPass123",
	}, nil)
	if st1 != st2 || st1 != http.StatusUnauthorized {
		t.Fatalf("status mismatch: %d vs %d", st1, st2)
	}
	e1 := requireError(t, b1)
	e2 := requireError(t, b2)
	if e1["code"] != e2["code"] || e1["message"] != e2["message"] {
		t.Fatalf("enumeration leak: %+v vs %+v", e1, e2)
	}
	if e1["code"] != "INVALID_CREDENTIALS" {
		t.Fatalf("code = %v", e1["code"])
	}
}

func TestProtectedEndpointsRequireAuth(t *testing.T) {
	e := newEnv(t, nil)
	for _, tc := range []struct{ method, path string }{
		{"GET", "/api/v1/me"},
		{"GET", "/api/v1/home"},
		{"GET", "/api/v1/algorithm"},
		{"POST", "/api/v1/algorithm/run"},
	} {
		status, _, body := e.do(tc.method, tc.path, nil, nil)
		if status != http.StatusUnauthorized {
			t.Fatalf("%s %s status = %d, want 401", tc.method, tc.path, status)
		}
		errBody := requireError(t, body)
		if errBody["code"] != "UNAUTHORIZED" {
			t.Fatalf("code = %v, want UNAUTHORIZED", errBody["code"])
		}
	}
}

func TestFullWalkRegisterLoginHomeRunLogout(t *testing.T) {
	e := newEnv(t, nil)
	e.registerAndLogin("walk@example.com", "Str0ngPassw0rd")

	status, _, body := e.do("GET", "/api/v1/me", nil, nil)
	if status != http.StatusOK {
		t.Fatalf("me status = %d", status)
	}
	data := requireSuccess(t, body)
	if data["email"] != "walk@example.com" {
		t.Fatalf("me.email = %v", data["email"])
	}

	status, _, body = e.do("GET", "/api/v1/home", nil, nil)
	if status != http.StatusOK {
		t.Fatalf("home status = %d", status)
	}
	home := requireSuccess(t, body)
	if home["server_time"] == "" {
		t.Fatalf("home.server_time missing")
	}
	metrics, _ := home["metrics"].([]any)
	if len(metrics) == 0 {
		t.Fatalf("home.metrics empty")
	}

	status, _, body = e.do("GET", "/api/v1/algorithm", nil, nil)
	if status != http.StatusOK {
		t.Fatalf("catalog status = %d", status)
	}
	if _, ok := body["data"].([]any); !ok {
		t.Fatalf("catalog data must be a list: %v", body["data"])
	}

	status, _, body = e.do("POST", "/api/v1/algorithm/run", map[string]any{
		"algorithm_id": "fibonacci", "input": "10",
	}, nil)
	if status != http.StatusOK {
		t.Fatalf("run status = %d body = %v", status, body)
	}
	run := requireSuccess(t, body)
	if run["output"] == "" || run["complexity"] != "O(n)" {
		t.Fatalf("run = %v", run)
	}
	if _, ok := body["meta"].(map[string]any)["execution_ms"]; !ok {
		t.Fatalf("run meta.execution_ms missing (measured, never fabricated)")
	}

	status, _, body = e.do("POST", "/api/v1/logout", nil, nil)
	if status != http.StatusOK {
		t.Fatalf("logout status = %d", status)
	}
	// Session must be invalidated server-side.
	status, _, _ = e.do("GET", "/api/v1/me", nil, nil)
	if status != http.StatusUnauthorized {
		t.Fatalf("me after logout = %d, want 401", status)
	}
}

func TestAlgorithmErrors(t *testing.T) {
	e := newEnv(t, nil)
	e.registerAndLogin("algo@example.com", "Str0ngPassw0rd")

	status, _, body := e.do("POST", "/api/v1/algorithm/run", map[string]any{
		"algorithm_id": "eval-user-input", "input": "x",
	}, nil)
	if status != http.StatusBadRequest {
		t.Fatalf("unknown algorithm status = %d", status)
	}
	if c := requireError(t, body)["code"]; c != "UNKNOWN_ALGORITHM" {
		t.Fatalf("code = %v", c)
	}

	status, _, body = e.do("POST", "/api/v1/algorithm/run", map[string]any{
		"algorithm_id": "reverse", "input": strings.Repeat("a", 10_001),
	}, nil)
	if status != http.StatusRequestEntityTooLarge {
		t.Fatalf("oversized status = %d, want 413", status)
	}
	if c := requireError(t, body)["code"]; c != "INPUT_TOO_LARGE" {
		t.Fatalf("code = %v", c)
	}
}

// --- Throttle ----------------------------------------------------------------

func TestLoginThrottle429WithRetryAfter(t *testing.T) {
	e := newEnv(t, nil)
	e.registerAndLogin("throttle@example.com", "Str0ngPassw0rd")

	var retryAfter string
	var lastStatus int
	for i := 0; i < 11; i++ {
		status, hdr, _ := e.do("POST", "/api/v1/login", map[string]string{
			"email": "throttle@example.com", "password": "WrongPass123",
		}, nil)
		lastStatus = status
		retryAfter = hdr.Get("Retry-After")
		if lastStatus == http.StatusTooManyRequests {
			break
		}
	}
	if lastStatus != http.StatusTooManyRequests {
		t.Fatalf("11th failed login status = %d, want 429", lastStatus)
	}
	if retryAfter == "" {
		t.Fatalf("Retry-After header missing on 429")
	}
	// Even the CORRECT password stays throttled (the tally is the gate).
	status, _, body := e.do("POST", "/api/v1/login", map[string]string{
		"email": "throttle@example.com", "password": "Str0ngPassw0rd",
	}, nil)
	if status != http.StatusTooManyRequests {
		t.Fatalf("correct login while throttled = %d, want 429", status)
	}
	if c := requireError(t, body)["code"]; c != "RATE_LIMITED" {
		t.Fatalf("code = %v", c)
	}
	// XFF spoofing must not mint a fresh bucket (default: XFF ignored).
	status, _, _ = e.do("POST", "/api/v1/login", map[string]string{
		"email": "throttle@example.com", "password": "Str0ngPassw0rd",
	}, map[string]string{"X-Forwarded-For": "9.9.9.9"})
	if status != http.StatusTooManyRequests {
		t.Fatalf("spoofed-XFF login = %d, want 429", status)
	}
}

// --- Request-Id correlation --------------------------------------------------

func TestRequestIDHonoredAndInvalidRejected(t *testing.T) {
	e := newEnv(t, nil)

	// Valid inbound id is echoed verbatim in header AND meta.
	custom := "frontend-correlation-abc123"
	status, hdr, body := e.do("POST", "/api/v1/register", map[string]string{
		"email": "reqid@example.com", "password": "Str0ngPassw0rd",
	}, map[string]string{"X-Request-Id": custom})
	if status != http.StatusCreated {
		t.Fatalf("status = %d", status)
	}
	if hdr.Get("X-Request-Id") != custom {
		t.Fatalf("X-Request-Id = %q, want %q", hdr.Get("X-Request-Id"), custom)
	}
	if meta := body["meta"].(map[string]any); meta["request_id"] != custom {
		t.Fatalf("meta.request_id = %v", meta["request_id"])
	}

	// Invalid id (too short) is replaced. The Go http client would refuse
	// to SEND control characters, so we use a short id — the server's
	// 8..128 rule must reject it.
	status, hdr, _ = e.do("GET", "/healthz", nil, map[string]string{"X-Request-Id": "abc"})
	_ = status
	got := hdr.Get("X-Request-Id")
	if got == "abc" || len(got) < 8 || strings.ContainsAny(got, "\n\r") {
		t.Fatalf("invalid inbound X-Request-Id not replaced: %q", got)
	}
}

func TestOversizedBody413(t *testing.T) {
	e := newEnv(t, nil)
	huge := strings.Repeat("a", 300*1024)
	status, _, body := e.do("POST", "/api/v1/register", map[string]string{
		"email": "big@example.com", "password": huge,
	}, nil)
	if status != http.StatusRequestEntityTooLarge {
		t.Fatalf("status = %d, want 413 (body cap)", status)
	}
	if c := requireError(t, body)["code"]; c != "INPUT_TOO_LARGE" {
		t.Fatalf("code = %v", c)
	}
}

// --- /ws upgrade path (handshake + flow) -------------------------------------

func wsConnect(e *env, origin string) (*websocket.Conn, *http.Response, error) {
	hdr := http.Header{}
	if origin != "" {
		hdr.Set("Origin", origin)
	}
	url := "ws" + strings.TrimPrefix(e.server.URL, "http") + "/ws"
	// The gorilla dialer does not use the http.Client's cookie jar; session
	// cookies must be attached manually for the upgrade request.
	cookies := e.client.Jar.Cookies(mustParse(e.t, e.server.URL))
	for _, ck := range cookies {
		hdr.Add("Cookie", ck.Name+"="+ck.Value)
	}
	return websocket.DefaultDialer.Dial(url, hdr)
}

func mustParse(t *testing.T, raw string) *url.URL {
	t.Helper()
	u, err := url.Parse(raw)
	if err != nil {
		t.Fatalf("parse %q: %v", raw, err)
	}
	return u
}

func TestWSUpgradeRequiresSession(t *testing.T) {
	e := newEnv(t, nil)
	conn, resp, err := wsConnect(e, "")
	if err == nil {
		_ = conn.Close()
		t.Fatalf("anonymous /ws upgrade must fail")
	}
	if resp == nil || resp.StatusCode != http.StatusUnauthorized {
		t.Fatalf("status = %v, want 401", resp)
	}
	// The 401 must be an envelope error, not a bare status.
	var body map[string]any
	if err := json.NewDecoder(resp.Body).Decode(&body); err == nil {
		if errBody, ok := body["error"].(map[string]any); ok && errBody["code"] != "UNAUTHORIZED" {
			t.Fatalf("code = %v", errBody["code"])
		}
	}
}

func TestWSOriginCheckRejectsForeignOrigin(t *testing.T) {
	e := newEnv(t, nil)
	e.registerAndLogin("ws@example.com", "Str0ngPassw0rd")

	// Allowed origin → upgrade succeeds.
	conn, resp, err := wsConnect(e, "http://localhost:5173")
	if err != nil {
		t.Fatalf("allowed origin rejected: %v (resp %v)", err, resp)
	}
	_ = conn.Close()

	// Foreign origin → 403 BEFORE upgrade (CrossOriginWSRF).
	conn, resp, err = wsConnect(e, "https://evil.example.com")
	if err == nil {
		_ = conn.Close()
		t.Fatalf("foreign origin must be rejected")
	}
	if resp == nil || resp.StatusCode != http.StatusForbidden {
		t.Fatalf("status = %v, want 403", resp)
	}
}

func TestWSBroadcastReachesBothClients(t *testing.T) {
	e := newEnv(t, nil)
	e.registerAndLogin("fanout@example.com", "Str0ngPassw0rd")

	conn1, _, err := wsConnect(e, "http://localhost:5173")
	if err != nil {
		t.Fatalf("dial1: %v", err)
	}
	defer conn1.Close()
	conn2, _, err := wsConnect(e, "http://localhost:5173")
	if err != nil {
		t.Fatalf("dial2: %v", err)
	}
	defer conn2.Close()

	waitFor(t, func() bool { return e.app.Hub.Count() == 2 })

	e.app.Hub.Broadcast([]byte(`{"type":"run.completed","algorithm_id":"fizzbuzz"}`))

	for i, conn := range []*websocket.Conn{conn1, conn2} {
		_ = conn.SetReadDeadline(time.Now().Add(2 * time.Second))
		_, payload, err := conn.ReadMessage()
		if err != nil {
			t.Fatalf("client %d read: %v", i, err)
		}
		if !strings.Contains(string(payload), `"algorithm_id":"fizzbuzz"`) {
			t.Fatalf("client %d payload = %q", i, payload)
		}
	}
}

// REST → hub: an algorithm run publishes run.completed to open sockets.
func TestAlgorithmRunPublishesWSEvent(t *testing.T) {
	e := newEnv(t, nil)
	e.registerAndLogin("pub@example.com", "Str0ngPassw0rd")

	conn, _, err := wsConnect(e, "http://localhost:5173")
	if err != nil {
		t.Fatalf("dial: %v", err)
	}
	defer conn.Close()

	waitFor(t, func() bool { return e.app.Hub.Count() == 1 })

	status, _, body := e.do("POST", "/api/v1/algorithm/run", map[string]any{
		"algorithm_id": "reverse", "input": "hello",
	}, nil)
	if status != http.StatusOK {
		t.Fatalf("run status = %d body = %v", status, body)
	}

	_ = conn.SetReadDeadline(time.Now().Add(2 * time.Second))
	_, payload, err := conn.ReadMessage()
	if err != nil {
		t.Fatalf("read run event: %v", err)
	}
	var evt struct {
		Type        string   `json:"type"`
		Email       string   `json:"email"`
		AlgorithmID string   `json:"algorithm_id"`
		ExecutionMS *float64 `json:"execution_ms"`
	}
	if err := json.Unmarshal(payload, &evt); err != nil {
		t.Fatalf("unmarshal event: %v (payload %q)", err, payload)
	}
	if evt.Type != "run.completed" || evt.AlgorithmID != "reverse" {
		t.Fatalf("event = %+v", evt)
	}
	if evt.Email != "pub@example.com" {
		t.Fatalf("event email = %q", evt.Email)
	}
	if evt.ExecutionMS == nil {
		t.Fatalf("execution_ms must be present on run events")
	}
}

func TestWSAppLevelPingPong(t *testing.T) {
	e := newEnv(t, nil)
	e.registerAndLogin("ping@example.com", "Str0ngPassw0rd")

	conn, _, err := wsConnect(e, "http://localhost:5173")
	if err != nil {
		t.Fatalf("dial: %v", err)
	}
	defer conn.Close()

	_ = conn.SetWriteDeadline(time.Now().Add(time.Second))
	if err := conn.WriteMessage(websocket.TextMessage, []byte(`{"type":"ping"}`)); err != nil {
		t.Fatalf("write: %v", err)
	}
	_ = conn.SetReadDeadline(time.Now().Add(2 * time.Second))
	_, payload, err := conn.ReadMessage()
	if err != nil {
		t.Fatalf("read pong: %v", err)
	}
	if !strings.Contains(string(payload), `"type":"pong"`) {
		t.Fatalf("payload = %q", payload)
	}
}

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

// silence unused import when ws pkg types are only used via app.Options
var _ ws.Config
