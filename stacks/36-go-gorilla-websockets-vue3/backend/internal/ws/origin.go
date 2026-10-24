// Package ws — origin check (CrossOriginWSRF).
//
// WebSocket handshakes are NOT protected by the SameSite cookie policy the
// way form posts are: a browser attaches first-party cookies to cross-site
// WebSocket connects from pages on other origins (the "Cross-Origin WebSocket
// Hijacking" / CrossOriginWSRF class). The same-origin policy does not stop
// the HANDSHAKE, and gorilla's Upgrader deliberately leaves the decision to
// the application via CheckOrigin.
//
// Policy: the Origin header must be present and match an explicitly allowed
// scheme+host. Allowed origins are configured (dev default: the Vite dev
// server at http://localhost:5173 and the backend's own origin); anything
// else is rejected with 403 BEFORE the upgrade. Browsers always send Origin
// on WebSocket connects; non-browser clients (tests, smoke) can present a
// matching header or be denied.
package ws

import (
	"net/url"
	"strings"
)

// OriginChecker validates the Origin header of an upgrade request.
type OriginChecker struct {
	allowed map[string]struct{}
}

// NewOriginChecker builds a checker from allowed origins ("http://localhost:5173").
// Empty entries are ignored; the list is matched exactly (scheme lowered).
func NewOriginChecker(allowed []string) *OriginChecker {
	m := make(map[string]struct{}, len(allowed))
	for _, a := range allowed {
		a = strings.ToLower(strings.TrimSpace(a))
		if a != "" {
			m[a] = struct{}{}
		}
	}
	return &OriginChecker{allowed: m}
}

// AllowOrigin adds one origin to the allowlist at runtime.
func (o *OriginChecker) AllowOrigin(origin string) {
	origin = strings.ToLower(strings.TrimSpace(origin))
	if origin != "" {
		o.allowed[origin] = struct{}{}
	}
}

// Check implements the upgrade-time decision. It mirrors gorilla's
// CheckOrigin signature semantics: true = allow.
func (o *OriginChecker) Check(rOrigin string) bool {
	rOrigin = strings.ToLower(strings.TrimSpace(rOrigin))
	if rOrigin == "" {
		// Browsers always send Origin on WS; absence means a non-browser
		// client. Tests and the smoke client opt in via the config; the
		// production policy denies them unless listed.
		_, ok := o.allowed[""]
		return ok
	}
	u, err := url.Parse(rOrigin)
	if err != nil {
		return false
	}
	// Canonicalize to scheme://host (drop any path a client may append).
	canonical := strings.ToLower(u.Scheme + "://" + u.Host)
	_, ok := o.allowed[canonical]
	return ok
}

// SameOriginDefault returns the dev allowlist: Vite dev server + loopback
// variants of the backend itself.
func SameOriginDefault() []string {
	return []string{
		"http://localhost:5173",
		"http://127.0.0.1:5173",
	}
}
