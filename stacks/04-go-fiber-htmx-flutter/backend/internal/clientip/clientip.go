// Package clientip resolves the client identity used by the login throttle.
//
// Policy (identical to Stack 01's reviewed design):
//
//   - Default (no trusted proxies configured): X-Forwarded-For is IGNORED and
//     the direct TCP peer address is the client identity. A client cannot
//     rotate spoofed XFF headers to get fresh throttle buckets.
//   - With trusted proxies configured AND the immediate peer is one of them:
//     walk the X-Forwarded-For chain RIGHT to LEFT, skipping trusted hops,
//     and use the first untrusted address. Entries to the left of an
//     untrusted hop are attacker-controlled and never used. If every hop is
//     trusted, the leftmost entry (reported by the outermost trusted proxy)
//     is used.
//   - Trusted proxies configured but the peer is NOT trusted: the peer itself
//     is the identity; the header cannot be trusted from that connection.
package clientip

import (
	"net"
	"strings"
)

// Resolver decides which addresses may set X-Forwarded-For.
type Resolver struct {
	// trusted is the list of exact IPs or simple prefixes ending in "."
	// (for example "10.0." or "192.168.1.").
	trusted []string
}

// New builds a Resolver. Empty/whitespace entries are ignored; the default is
// an empty list, which makes XFF irrelevant.
func New(trusted []string) *Resolver {
	cleaned := make([]string, 0, len(trusted))
	for _, t := range trusted {
		t = strings.TrimSpace(t)
		if t != "" {
			cleaned = append(cleaned, t)
		}
	}
	return &Resolver{trusted: cleaned}
}

// ClientIP resolves the client identity per the documented policy.
func (r *Resolver) ClientIP(remoteAddr, xff string) string {
	peer := remoteAddr
	if host, _, err := net.SplitHostPort(remoteAddr); err == nil {
		peer = host
	}
	peer = strings.TrimSpace(peer)
	if peer == "" {
		return "unknown"
	}
	if len(r.trusted) == 0 || !r.isTrusted(peer) {
		return peer
	}
	xff = strings.TrimSpace(xff)
	if xff == "" {
		return peer
	}
	hops := strings.Split(xff, ",")
	// Rightmost first: the entry closest to us was appended by the proxy we
	// just verified as trusted.
	for i := len(hops) - 1; i >= 0; i-- {
		hop := strings.TrimSpace(hops[i])
		if hop != "" && !r.isTrusted(hop) {
			return hop
		}
	}
	// Every hop is trusted (chained proxies): use the leftmost entry, the
	// original client as reported by the outermost trusted proxy.
	return strings.TrimSpace(hops[0])
}

// isTrusted matches an exact IP or a simple prefix ("10.0.").
func (r *Resolver) isTrusted(candidate string) bool {
	for _, t := range r.trusted {
		if strings.EqualFold(t, candidate) {
			return true
		}
		if strings.HasSuffix(t, ".") && strings.HasPrefix(candidate, t) {
			return true
		}
	}
	return false
}
