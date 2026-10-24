// Package throttle implements the demo-grade login rate limiter.
//
// Policy (documented, mirrors Stack 01/04's final design):
//
//   - Only FAILED login attempts consume budget; successes never count and a
//     success clears the tally for that identity pair.
//   - The key is email + client IP so an attacker cannot lock out a victim
//     solely by hammering the victim's email, and one IP cannot silently try
//     many emails.
//   - The window is PINNED (fixed start), not sliding: each new window starts
//     at the first failure after the previous window expired. The Retry-After
//     is honest.
//   - Exceeding the limit -> HTTP 429 with Retry-After.
//   - X-Forwarded-For is IGNORED by default (see clientip package): a client
//     cannot rotate spoofed XFF identities to bypass the limit.
//
// This is in-process and demo-grade by design; production deployments must
// enforce limits at the edge/proxy (documented in ARCHITECTURE.md).
package throttle

import (
	"sync"
	"time"
)

// Config controls the limiter.
type Config struct {
	// MaxFailed is the maximum number of FAILED attempts per pinned window.
	MaxFailed int
	// Window is the pinned window length.
	Window time.Duration
	// RetryAfter is advertised with HTTP 429 as Retry-After seconds.
	RetryAfter time.Duration
	// MaxKeys bounds memory so unbounded unique keys cannot exhaust the
	// process (a crude eviction keeps the map small under key-flood).
	MaxKeys int
}

// Default is the documented policy: 10 failed attempts / 60s, Retry-After 60.
func Default() Config {
	return Config{
		MaxFailed:  10,
		Window:     60 * time.Second,
		RetryAfter: 60 * time.Second,
		MaxKeys:    10_000,
	}
}

type windowState struct {
	count  int
	window time.Time
}

// Limiter is a keyed fixed-window failed-attempt counter. It is safe for
// concurrent use.
type Limiter struct {
	mu      sync.Mutex
	cfg     Config
	now     func() time.Time
	attempt map[string]*windowState
}

// New creates a Limiter with the given config and clock (nil = time.Now).
func New(cfg Config, now func() time.Time) *Limiter {
	if now == nil {
		now = time.Now
	}
	return &Limiter{cfg: cfg, now: now, attempt: make(map[string]*windowState)}
}

// Allow reports whether one more FAILED attempt may be recorded for key.
// It records the attempt atomically: when it returns false the limit is
// exhausted and the handler must answer 429.
func (l *Limiter) Allow(key string) bool {
	l.mu.Lock()
	defer l.mu.Unlock()
	l.evictIfNeeded()
	now := l.now()
	st, ok := l.attempt[key]
	if !ok || now.Sub(st.window) > l.cfg.Window {
		// Pin a fresh window at the first failure inside it.
		l.attempt[key] = &windowState{count: 1, window: now}
		return true
	}
	st.count++
	return st.count <= l.cfg.MaxFailed
}

// Clear resets the tally for key (called after a successful login).
func (l *Limiter) Clear(key string) {
	l.mu.Lock()
	defer l.mu.Unlock()
	delete(l.attempt, key)
}

// RetryAfterSeconds returns the Retry-After header value for 429 responses.
func (l *Limiter) RetryAfterSeconds() int {
	if l.cfg.RetryAfter <= 0 {
		return 60
	}
	return int(l.cfg.RetryAfter / time.Second)
}

// evictIfNeeded does a cheap eviction when the key space overflows, so
// memory stays bounded under a key flood. It must be called with the lock held.
func (l *Limiter) evictIfNeeded() {
	if len(l.attempt) < l.cfg.MaxKeys {
		return
	}
	// Drop expired windows first; if none expired, drop an arbitrary key
	// (bounded memory matters more than fairness for a demo limiter).
	now := l.now()
	for k, st := range l.attempt {
		if now.Sub(st.window) > l.cfg.Window {
			delete(l.attempt, k)
			if len(l.attempt) < l.cfg.MaxKeys {
				return
			}
		}
	}
	for k := range l.attempt {
		delete(l.attempt, k)
		if len(l.attempt) < l.cfg.MaxKeys {
			return
		}
	}
}
