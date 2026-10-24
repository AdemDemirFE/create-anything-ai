package app_test

import (
	"net/url"
	"strings"
	"testing"
)

// Web screen integration tests: the server-rendered htmx front end must serve
// the four screens, show visible errors, redirect unauthenticated page
// requests, and behave identically in htmx fragment mode.

// TestWebScreensServeWithoutAuth asserts register/login render as full HTML
// pages with accessible labels.
func TestWebScreensServeWithoutAuth(t *testing.T) {
	a := newApp(t)

	reg := get(t, a, "/register", nil)
	if reg.StatusCode != 200 || !strings.Contains(reg.Body, "<!DOCTYPE html>") {
		t.Fatalf("register page = %d", reg.StatusCode)
	}
	if !strings.Contains(reg.Body, `id="email"`) || !strings.Contains(reg.Body, `id="password"`) {
		t.Error("register page must label its inputs (accessibility)")
	}

	login := get(t, a, "/login", nil)
	if login.StatusCode != 200 || !strings.Contains(login.Body, `id="password"`) {
		t.Fatalf("login page = %d", login.StatusCode)
	}
	if strings.Contains(login.Body, "hx-post=\"/login\"") == false {
		t.Error("login form must carry the htmx enhancement hook")
	}
}

// TestWebRootRedirects asserts / sends anonymous users to /login. Fiber's
// redirect helper answers 303 (See Other), which browsers treat the same.
func TestWebRootRedirects(t *testing.T) {
	a := newApp(t)
	resp := get(t, a, "/", nil)
	if resp.StatusCode != 303 {
		t.Fatalf("root = %d, want 303", resp.StatusCode)
	}
	loc := resp.Header.Get("Location")
	if !strings.Contains(loc, "/login") {
		t.Fatalf("root Location = %q, want /login", loc)
	}
}

// TestWebProtectedPageRedirectsToLogin asserts the 401 surface for pages:
// unauthenticated /home redirects to /login with a flash.
func TestWebProtectedPageRedirectsToLogin(t *testing.T) {
	a := newApp(t)
	resp := get(t, a, "/home", nil)
	if resp.StatusCode != 303 {
		t.Fatalf("/home anonymous = %d, want 303", resp.StatusCode)
	}
	if !strings.Contains(resp.Header.Get("Location"), "flash=login-required") {
		t.Fatalf("Location = %q, want flash=login-required", resp.Header.Get("Location"))
	}

	// htmx mode: 401 + HX-Redirect instead of a page redirect.
	hx := get(t, a, "/home", map[string]string{"HX-Request": "true"})
	if hx.StatusCode != 401 {
		t.Fatalf("/home htmx anonymous = %d, want 401", hx.StatusCode)
	}
	if hx.Header.Get("HX-Redirect") != "/login" {
		t.Fatalf("HX-Redirect = %q, want /login", hx.Header.Get("HX-Redirect"))
	}
}

// TestWebRegisterLoginHomeFlow walks the full browser journey with cookies:
// register form -> login form -> home shows the email -> logout kills it.
func TestWebRegisterLoginHomeFlow(t *testing.T) {
	a := newApp(t)

	// Register via the web form (urlencoded, like a browser).
	reg := form(t, a, "/register", url.Values{
		"email":    {"webuser@example.com"},
		"password": {"Password123"},
	}, nil)
	if reg.StatusCode != 303 {
		t.Fatalf("register form = %d, want 303 redirect to login", reg.StatusCode)
	}
	if !strings.Contains(reg.Header.Get("Location"), "flash=registered") {
		t.Fatalf("register Location = %q", reg.Header.Get("Location"))
	}

	// Login via the web form; capture the session cookie.
	login := form(t, a, "/login", url.Values{
		"email":    {"webuser@example.com"},
		"password": {"Password123"},
	}, nil)
	if login.StatusCode != 303 {
		t.Fatalf("login form = %d, body=%s", login.StatusCode, login.Body)
	}
	session := webSessionCookie(t, login)
	if session == "" {
		t.Fatal("web login must set the session cookie")
	}

	// Home with the cookie renders the signed-in screen.
	home := get(t, a, "/home", map[string]string{"Cookie": "STACK04_SESSION=" + session})
	if home.StatusCode != 200 {
		t.Fatalf("home with cookie = %d", home.StatusCode)
	}
	if !strings.Contains(home.Body, "webuser@example.com") {
		t.Error("home must show the signed-in email")
	}

	// Algorithm screen renders the fixed catalog.
	alg := get(t, a, "/algorithm", map[string]string{"Cookie": "STACK04_SESSION=" + session})
	if alg.StatusCode != 200 || !strings.Contains(alg.Body, "FizzBuzz") {
		t.Fatalf("algorithm page = %d (catalog missing?)", alg.StatusCode)
	}

	// Running an algorithm from the form shows output + measured time + Big-O.
	run := form(t, a, "/algorithm/run", url.Values{
		"algorithm_id": {"fizzbuzz"},
		"input":        {"5"},
	}, map[string]string{"Cookie": "STACK04_SESSION=" + session})
	if run.StatusCode != 200 || !strings.Contains(run.Body, "Fizz") {
		t.Fatalf("algorithm run = %d", run.StatusCode)
	}
	if !strings.Contains(run.Body, "Measured duration") || !strings.Contains(run.Body, "Theoretical complexity") {
		t.Error("workbench must show measured duration AND theoretical complexity separately")
	}

	// Logout invalidates the session server-side.
	logout := form(t, a, "/logout", url.Values{},
		map[string]string{"Cookie": "STACK04_SESSION=" + session})
	if logout.StatusCode != 303 {
		t.Fatalf("logout = %d", logout.StatusCode)
	}
	after := get(t, a, "/home", map[string]string{"Cookie": "STACK04_SESSION=" + session})
	if after.StatusCode != 303 {
		t.Fatalf("home after logout = %d, want 303 to login", after.StatusCode)
	}
}

// TestWebFormErrorsAreVisible asserts failed submits re-render with visible
// error text and field-level messages (the contract: form hataları gorunur).
func TestWebFormErrorsAreVisible(t *testing.T) {
	a := newApp(t)

	// Invalid register: both fields wrong.
	bad := form(t, a, "/register", url.Values{
		"email":    {"not-an-email"},
		"password": {"short"},
	}, nil)
	if bad.StatusCode != 422 {
		t.Fatalf("bad register = %d, want 422", bad.StatusCode)
	}
	if !strings.Contains(bad.Body, "Please fix the highlighted fields") {
		t.Error("register error must be visible on the page")
	}
	if !strings.Contains(bad.Body, "field-error") {
		t.Error("field-level errors must be rendered")
	}

	// Duplicate email.
	form(t, a, "/register", url.Values{
		"email":    {"dupe@example.com"},
		"password": {"Password123"},
	}, nil)
	dup := form(t, a, "/register", url.Values{
		"email":    {"dupe@example.com"},
		"password": {"Password123"},
	}, nil)
	if dup.StatusCode != 422 || !strings.Contains(dup.Body, "already exists") {
		t.Fatalf("duplicate register = %d, body=%s", dup.StatusCode, dup.Body)
	}

	// Wrong password on login: generic message, no enumeration.
	wrong := form(t, a, "/login", url.Values{
		"email":    {"dupe@example.com"},
		"password": {"WrongPass123"},
	}, nil)
	if wrong.StatusCode != 422 || !strings.Contains(wrong.Body, "Invalid email or password.") {
		t.Fatalf("wrong login = %d", wrong.StatusCode)
	}
}

// TestWebThrottledLoginShowsError asserts the web surface of 429: after
// burning the failed-attempt budget, the WEB path answers 429 + Retry-After
// with the rate-limit error visible — mirroring the JSON API instead of the
// API's 429 collapsing into the web path's 422.
func TestWebThrottledLoginShowsError(t *testing.T) {
	a := newApp(t)
	form(t, a, "/register", url.Values{
		"email":    {"throttle@example.com"},
		"password": {"Password123"},
	}, nil)

	var last response
	for i := 0; i < 11; i++ {
		last = form(t, a, "/login", url.Values{
			"email":    {"throttle@example.com"},
			"password": {"WrongPass123"},
		}, nil)
	}
	if last.StatusCode != 429 {
		t.Fatalf("throttled web login = %d, want 429 (mirrors the JSON API)", last.StatusCode)
	}
	if last.Header.Get("Retry-After") == "" {
		t.Error("429 must carry Retry-After on the web path too")
	}
	if !strings.Contains(last.Body, "Too many failed attempts") {
		t.Error("rate-limit error must be visible on the web form")
	}

	// htmx mode: same status + header, error carried in the fragment.
	hx := form(t, a, "/login", url.Values{
		"email":    {"throttle@example.com"},
		"password": {"WrongPass123"},
	}, map[string]string{"HX-Request": "true"})
	if hx.StatusCode != 429 {
		t.Fatalf("throttled htmx login = %d, want 429", hx.StatusCode)
	}
	if hx.Header.Get("Retry-After") == "" {
		t.Error("429 must carry Retry-After in htmx mode")
	}
	if strings.Contains(hx.Body, "<!DOCTYPE html>") {
		t.Error("htmx 429 response must be a fragment, not a full page")
	}
	if !strings.Contains(hx.Body, `id="login-form"`) {
		t.Error("429 fragment must carry the login-form id for the outerHTML swap")
	}
	if !strings.Contains(hx.Body, "Too many failed attempts") {
		t.Error("rate-limit error must be visible inside the htmx fragment")
	}
}

// TestWebHtmxFragments asserts htmx mode swaps fragments instead of pages:
// a failed htmx login returns the form fragment with 422; a successful htmx
// login responds 204 with HX-Redirect.
func TestWebHtmxFragments(t *testing.T) {
	a := newApp(t)
	form(t, a, "/register", url.Values{
		"email":    {"htmx@example.com"},
		"password": {"Password123"},
	}, nil)

	// Failed htmx login -> 422 fragment (htmx swaps it into #login-form).
	bad := form(t, a, "/login", url.Values{
		"email":    {"htmx@example.com"},
		"password": {"WrongPass123"},
	}, map[string]string{"HX-Request": "true"})
	if bad.StatusCode != 422 {
		t.Fatalf("htmx bad login = %d, want 422", bad.StatusCode)
	}
	if strings.Contains(bad.Body, "<!DOCTYPE html>") {
		t.Error("htmx error response must be a fragment, not a full page")
	}
	if !strings.Contains(bad.Body, `id="login-form"`) {
		t.Error("fragment must carry the login-form id for the outerHTML swap")
	}

	// Successful htmx login -> 204 + HX-Redirect.
	ok := form(t, a, "/login", url.Values{
		"email":    {"htmx@example.com"},
		"password": {"Password123"},
	}, map[string]string{"HX-Request": "true"})
	if ok.StatusCode != 204 {
		t.Fatalf("htmx ok login = %d, want 204", ok.StatusCode)
	}
	if ok.Header.Get("HX-Redirect") != "/home" {
		t.Fatalf("HX-Redirect = %q, want /home", ok.Header.Get("HX-Redirect"))
	}

	// htmx algorithm run swaps the result fragment.
	r1 := form(t, a, "/login", url.Values{
		"email":    {"htmx@example.com"},
		"password": {"Password123"},
	}, nil)
	session := webSessionCookie(t, r1)
	run := form(t, a, "/algorithm/run", url.Values{
		"algorithm_id": {"reverse"},
		"input":        {"abc"},
	}, map[string]string{
		"Cookie":     "STACK04_SESSION=" + session,
		"HX-Request": "true",
	})
	if run.StatusCode != 200 || !strings.Contains(run.Body, "cba") {
		t.Fatalf("htmx run = %d", run.StatusCode)
	}
	if strings.Contains(run.Body, "<!DOCTYPE html>") {
		t.Error("htmx run response must be the result fragment, not a page")
	}
}

// webSessionCookie extracts the session cookie from a web form response.
func webSessionCookie(t *testing.T, resp response) string {
	t.Helper()
	for _, c := range resp.Cookies {
		if c.Name == "STACK04_SESSION" {
			return c.Value
		}
	}
	return ""
}
