// Package app_test drives the REAL application wiring (app.New) through
// net/http/httptest. These are integration tests: they exercise the Fiber
// stack, middleware, cookies, JSON envelope, and web templates end to end —
// the same binary a browser would talk to.
package app_test

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"

	"github.com/gofiber/fiber/v3"

	"github.com/AdemDemirFE/create-anything-ai/stacks/04-go-fiber-htmx-flutter/backend/internal/app"
)

// response captures what the tests need from a fiber exchange.
type response struct {
	StatusCode int
	Header     http.Header
	Body       string
	Cookies    []*http.Cookie
}

// app is the real application under test; each test gets a fresh instance
// (cheap: in-memory store). Requests go through fiber's App.Test, which runs
// the full middleware + handler chain exactly as in production.
func newApp(t *testing.T) *fiber.App {
	t.Helper()
	return app.New()
}

// do performs a request against the fiber app. contentType defaults to
// application/json; callers pass an explicit type for form posts.
func do(t *testing.T, a *fiber.App, method, path string, body io.Reader, headers map[string]string) response {
	t.Helper()
	req := httptest.NewRequest(method, path, body)
	contentType := "application/json"
	if ct, ok := headers["Content-Type"]; ok {
		contentType = ct
		delete(headers, "Content-Type")
	}
	req.Header.Set("Content-Type", contentType)
	for k, v := range headers {
		req.Header.Set(k, v)
	}
	resp, err := a.Test(req)
	if err != nil {
		t.Fatalf("app.Test(%s %s): %v", method, path, err)
	}
	raw, err := io.ReadAll(resp.Body)
	if err != nil {
		t.Fatalf("read body: %v", err)
	}
	return response{
		StatusCode: resp.StatusCode,
		Header:     resp.Header,
		Body:       string(raw),
		Cookies:    readCookies(resp.Header.Values("Set-Cookie")),
	}
}

// envelope mirrors the section-7 contract for assertions.
type envelope struct {
	Success bool            `json:"success"`
	Data    json.RawMessage `json:"data"`
	Error   *struct {
		Code    string `json:"code"`
		Message string `json:"message"`
		Details []struct {
			Field string `json:"field"`
			Code  string `json:"code"`
		} `json:"details"`
	} `json:"error"`
	Meta struct {
		Timestamp   string   `json:"timestamp"`
		ExecutionMS *float64 `json:"execution_ms"`
		RequestID   string   `json:"request_id"`
	} `json:"meta"`
}

// readCookies parses Set-Cookie headers.
func readCookies(setCookies []string) []*http.Cookie {
	var out []*http.Cookie
	for _, raw := range setCookies {
		if c, err := http.ParseSetCookie(raw); err == nil {
			out = append(out, c)
		}
	}
	return out
}

// postJSON sends a JSON request and decodes the envelope.
func postJSON(t *testing.T, a *fiber.App, path string, bodyData any, headers map[string]string) (response, envelope) {
	t.Helper()
	raw, err := json.Marshal(bodyData)
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}
	resp := do(t, a, fiber.MethodPost, path, bytes.NewReader(raw), headers)
	return resp, decodeEnvelope(t, resp)
}

func get(t *testing.T, a *fiber.App, path string, headers map[string]string) response {
	t.Helper()
	return do(t, a, fiber.MethodGet, path, nil, headers)
}

func decodeEnvelope(t *testing.T, resp response) envelope {
	t.Helper()
	var e envelope
	if err := json.Unmarshal([]byte(resp.Body), &e); err != nil {
		t.Fatalf("invalid JSON: %v\nbody: %s", err, resp.Body)
	}
	return e
}

func validUser(i int) map[string]any {
	return map[string]any{
		"email":    fmt.Sprintf("user%d@example.com", i),
		"password": "Password123",
	}
}

// TestEnvelopeShapeOnSuccessAndError asserts the section-7 contract on both
// branches: success {success,data,error,meta}, error {code,message,details?}.
func TestEnvelopeShapeOnSuccessAndError(t *testing.T) {
	a := newApp(t)

	resp, e := postJSON(t, a, "/api/v1/register", validUser(1), nil)
	if resp.StatusCode != http.StatusCreated {
		t.Fatalf("register status = %d, want 201", resp.StatusCode)
	}
	if !e.Success || e.Error != nil {
		t.Fatalf("success envelope wrong: %+v", e)
	}
	if e.Meta.Timestamp == "" || e.Meta.RequestID == "" {
		t.Fatalf("meta missing timestamp/request_id: %+v", e.Meta)
	}

	// Error branch: duplicate email.
	resp, e = postJSON(t, a, "/api/v1/register", validUser(1), nil)
	if resp.StatusCode != http.StatusConflict {
		t.Fatalf("duplicate register status = %d, want 409", resp.StatusCode)
	}
	if e.Success {
		t.Fatalf("error envelope must have success=false: %+v", e)
	}
	if len(e.Data) != 0 && string(e.Data) != "null" {
		t.Fatalf("error envelope must have data=null: %s", e.Data)
	}
	if e.Error == nil {
		t.Fatal("error envelope must carry an error object")
	}
	if e.Error.Code != "EMAIL_TAKEN" || e.Error.Message == "" {
		t.Fatalf("error body wrong: %+v", e.Error)
	}
	if e.Meta.RequestID == "" {
		t.Fatal("error envelope must also carry a request_id")
	}
}

// TestRegisterValidationErrorsAreFieldLevel asserts VALIDATION_ERROR with
// per-field details for bad email + weak password.
func TestRegisterValidationErrorsAreFieldLevel(t *testing.T) {
	a := newApp(t)
	resp, e := postJSON(t, a, "/api/v1/register", map[string]any{
		"email": "not-an-email", "password": "short",
	}, nil)
	if resp.StatusCode != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400", resp.StatusCode)
	}
	if e.Error == nil || e.Error.Code != "VALIDATION_ERROR" {
		t.Fatalf("code = %+v, want VALIDATION_ERROR", e.Error)
	}
	codes := map[string]bool{}
	for _, d := range e.Error.Details {
		codes[d.Field] = true
	}
	if !codes["email"] || !codes["password"] {
		t.Fatalf("field details missing: %+v", e.Error.Details)
	}
}

// TestLoginSetsHttpOnlySessionCookie asserts the cookie contract.
func TestLoginSetsHttpOnlySessionCookie(t *testing.T) {
	a := newApp(t)
	postJSON(t, a, "/api/v1/register", validUser(2), nil)

	resp, e := postJSON(t, a, "/api/v1/login", validUser(2), nil)
	if resp.StatusCode != http.StatusOK || !e.Success {
		t.Fatalf("login = %d, %+v", resp.StatusCode, e)
	}
	found := false
	for _, c := range resp.Cookies {
		if c.Name == "STACK04_SESSION" {
			found = true
			if !c.HttpOnly {
				t.Error("session cookie must be HttpOnly")
			}
			if c.Secure {
				t.Error("session cookie Secure must be false without COOKIE_SECURE")
			}
			if c.Value == "" {
				t.Error("session cookie value empty")
			}
		}
	}
	if !found {
		t.Fatalf("STACK04_SESSION cookie not set; got %v", resp.Cookies)
	}
}

// TestProtectedEndpointsRejectUnauthenticated asserts 401 + UNAUTHORIZED on
// every protected API path without a session.
func TestProtectedEndpointsRejectUnauthenticated(t *testing.T) {
	a := newApp(t)
	for _, path := range []string{"/api/v1/home", "/api/v1/me", "/api/v1/algorithm"} {
		resp := get(t, a, path, nil)
		e := decodeEnvelope(t, resp)
		if resp.StatusCode != http.StatusUnauthorized {
			t.Errorf("%s: status = %d, want 401", path, resp.StatusCode)
		}
		if e.Error == nil || e.Error.Code != "UNAUTHORIZED" {
			t.Errorf("%s: error = %+v, want UNAUTHORIZED", path, e.Error)
		}
	}
	// POST /algorithm/run without session as well.
	resp, e := postJSON(t, a, "/api/v1/algorithm/run", map[string]any{
		"algorithm_id": "reverse", "input": "abc",
	}, nil)
	if resp.StatusCode != http.StatusUnauthorized || e.Error.Code != "UNAUTHORIZED" {
		t.Fatalf("run without session: %d %+v", resp.StatusCode, e)
	}
}

// TestLoginSuccessGrantsProtectedAccess walks register -> login -> home ->
// algorithm run with the session cookie, then logout -> home is 401 again.
func TestLoginSuccessGrantsProtectedAccess(t *testing.T) {
	a := newApp(t)
	postJSON(t, a, "/api/v1/register", validUser(3), nil)

	resp, _ := postJSON(t, a, "/api/v1/login", validUser(3), nil)
	session := sessionCookie(t, resp)

	home := get(t, a, "/api/v1/home", map[string]string{"Cookie": "STACK04_SESSION=" + session})
	eh := decodeEnvelope(t, home)
	if home.StatusCode != http.StatusOK || !eh.Success {
		t.Fatalf("home = %d, %+v", home.StatusCode, eh)
	}
	var homeData struct {
		Email   string `json:"email"`
		Metrics []any  `json:"metrics"`
	}
	json.Unmarshal(eh.Data, &homeData)
	if homeData.Email != "user3@example.com" || len(homeData.Metrics) == 0 {
		t.Fatalf("home data wrong: %+v", homeData)
	}

	run, er := postJSON(t, a, "/api/v1/algorithm/run",
		map[string]any{"algorithm_id": "reverse", "input": "abc"},
		map[string]string{"Cookie": "STACK04_SESSION=" + session})
	if run.StatusCode != http.StatusOK || !er.Success {
		t.Fatalf("run = %d, %+v", run.StatusCode, er)
	}
	var runData struct {
		Output      string   `json:"output"`
		ExecutionMS *float64 `json:"execution_ms"`
		Complexity  string   `json:"complexity"`
	}
	json.Unmarshal(er.Data, &runData)
	if runData.Output != "cba" || runData.Complexity != "O(n)" {
		t.Fatalf("run data wrong: %+v", runData)
	}
	if runData.ExecutionMS == nil {
		t.Fatal("execution_ms must be present on algorithm runs (measured, not fabricated)")
	}
	if er.Meta.ExecutionMS == nil {
		t.Fatal("meta.execution_ms must be set for measured endpoints")
	}

	// Logout invalidates server-side: the old cookie is dead.
	logout, _ := postJSON(t, a, "/api/v1/logout", map[string]any{},
		map[string]string{"Cookie": "STACK04_SESSION=" + session})
	if logout.StatusCode != http.StatusOK {
		t.Fatalf("logout = %d", logout.StatusCode)
	}
	after := get(t, a, "/api/v1/home", map[string]string{"Cookie": "STACK04_SESSION=" + session})
	if after.StatusCode != http.StatusUnauthorized {
		t.Fatalf("home after logout = %d, want 401", after.StatusCode)
	}
	eeBody := decodeEnvelope(t, after)
	if eeBody.Error == nil || eeBody.Error.Code != "UNAUTHORIZED" {
		t.Fatalf("home after logout error = %+v, want UNAUTHORIZED", eeBody.Error)
	}
}

// TestLoginThrottleReturns429WithRetryAfter asserts the review-mandated
// behavior: 11 failed attempts -> 429 + Retry-After, and rotating spoofed
// X-Forwarded-For headers does NOT reset the counter (identity is the TCP
// peer while XFF is not trusted).
func TestLoginThrottleReturns429WithRetryAfter(t *testing.T) {
	a := newApp(t)
	postJSON(t, a, "/api/v1/register", validUser(4), nil)

	creds := map[string]any{"email": "user4@example.com", "password": "WrongPass123"}
	var lastResp response
	var lastEnv envelope
	for i := 0; i < 11; i++ {
		// Each failed attempt uses a DIFFERENT spoofed XFF: the limit must
		// still trip because the throttle keys on the TCP peer.
		xff := fmt.Sprintf("10.0.%d.%d", i, i)
		lastResp, lastEnv = postJSON(t, a, "/api/v1/login", creds,
			map[string]string{"X-Forwarded-For": xff})
		if i < 10 && lastResp.StatusCode != http.StatusUnauthorized {
			t.Fatalf("attempt %d: status = %d, want 401", i+1, lastResp.StatusCode)
		}
	}
	if lastResp.StatusCode != http.StatusTooManyRequests {
		t.Fatalf("11th failed attempt: status = %d, want 429", lastResp.StatusCode)
	}
	if lastEnv.Error == nil || lastEnv.Error.Code != "RATE_LIMITED" {
		t.Fatalf("429 code = %+v, want RATE_LIMITED", lastEnv.Error)
	}
	if ra := lastResp.Header.Get("Retry-After"); ra == "" {
		t.Fatal("429 must carry Retry-After")
	}

	// A correct login from the SAME throttled identity is still 429 (the
	// limit counts failed attempts; success does not bypass a live limit).
	ok, e := postJSON(t, a, "/api/v1/login", validUser(4), nil)
	if ok.StatusCode != http.StatusTooManyRequests || e.Error.Code != "RATE_LIMITED" {
		t.Fatalf("throttled correct login: %d %+v", ok.StatusCode, e)
	}
}

// TestWrongPasswordAndUnknownEmailAreIdentical asserts no account
// enumeration: same status, code, and message for both failures.
func TestWrongPasswordAndUnknownEmailAreIdentical(t *testing.T) {
	a := newApp(t)
	postJSON(t, a, "/api/v1/register", validUser(5), nil)

	resp1, e1 := postJSON(t, a, "/api/v1/login",
		map[string]any{"email": "user5@example.com", "password": "WrongPass123"}, nil)
	resp2, e2 := postJSON(t, a, "/api/v1/login",
		map[string]any{"email": "ghost@example.com", "password": "WrongPass123"}, nil)
	if resp1.StatusCode != resp2.StatusCode || e1.Error.Code != e2.Error.Code ||
		e1.Error.Message != e2.Error.Message {
		t.Fatalf("enumeration leak: (%d,%s,%s) vs (%d,%s,%s)",
			resp1.StatusCode, e1.Error.Code, e1.Error.Message,
			resp2.StatusCode, e2.Error.Code, e2.Error.Message)
	}
}

// TestAlgorithmUnknownAndOversized asserts the stable workbench errors.
func TestAlgorithmUnknownAndOversized(t *testing.T) {
	a := newApp(t)
	postJSON(t, a, "/api/v1/register", validUser(6), nil)
	resp, _ := postJSON(t, a, "/api/v1/login", validUser(6), nil)
	session := sessionCookie(t, resp)
	h := map[string]string{"Cookie": "STACK04_SESSION=" + session}

	r, e := postJSON(t, a, "/api/v1/algorithm/run",
		map[string]any{"algorithm_id": "user-code", "input": "x"}, h)
	if r.StatusCode != http.StatusBadRequest || e.Error.Code != "UNKNOWN_ALGORITHM" {
		t.Fatalf("unknown algorithm: %d %+v", r.StatusCode, e)
	}

	big := strings.Repeat("a", 10_001)
	r, e = postJSON(t, a, "/api/v1/algorithm/run",
		map[string]any{"algorithm_id": "reverse", "input": big}, h)
	if r.StatusCode != http.StatusRequestEntityTooLarge || e.Error.Code != "INPUT_TOO_LARGE" {
		t.Fatalf("oversized: %d %+v", r.StatusCode, e)
	}
}

// TestRequestBodyLimitIsBounded asserts oversized request bodies are rejected
// by the server (413), not processed. fiber's App.Test surfaces the fasthttp
// body-limit error as a Go error before the response exists — that IS the
// rejection path.
func TestRequestBodyLimitIsBounded(t *testing.T) {
	a := newApp(t)
	big := strings.Repeat("a", 300*1024) // 300KB > 256KB body limit
	raw, _ := json.Marshal(map[string]any{"email": "x@example.com", "password": big})
	req := httptest.NewRequest(fiber.MethodPost, "/api/v1/register", bytes.NewReader(raw))
	req.Header.Set("Content-Type", "application/json")
	_, err := a.Test(req)
	if err == nil {
		t.Fatal("oversized body must be rejected with an error (fasthttp body limit)")
	}
	if !strings.Contains(err.Error(), "body size") {
		t.Fatalf("unexpected error: %v", err)
	}
}

// sessionCookie extracts the STACK04_SESSION cookie value.
func sessionCookie(t *testing.T, resp response) string {
	t.Helper()
	for _, c := range resp.Cookies {
		if c.Name == "STACK04_SESSION" {
			return c.Value
		}
	}
	t.Fatal("session cookie missing")
	return ""
}

// form posts urlencoded data like a browser would.
func form(t *testing.T, a *fiber.App, path string, values url.Values, headers map[string]string) response {
	t.Helper()
	merged := map[string]string{"Content-Type": "application/x-www-form-urlencoded"}
	for k, v := range headers {
		merged[k] = v
	}
	return do(t, a, fiber.MethodPost, path, strings.NewReader(values.Encode()), merged)
}

func body(t *testing.T, resp response) string {
	t.Helper()
	return resp.Body
}
