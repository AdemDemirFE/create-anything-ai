// Package store defines the persistence boundary of the backend and its
// in-memory implementation.
//
// DESIGN DECISION (documented, reference-grade):
//
// The reference implementation uses a thread-safe IN-MEMORY store. Reasons:
//
//  1. The stack's verification target is `go test ./...` with real httptest
//     integration tests; no external database service is required, so every
//     claim in verification.md is reproducible from a clean checkout with Go
//     alone.
//  2. SQLite via CGO (mattn/go-sqlite3) would add a C toolchain requirement on
//     Windows; the modernc.org pure-Go driver would pull a large dependency
//     tree into a deliberately minimal go.mod.
//  3. The four-screen contract (register/login/home/algorithm) does not need
//     durability for this maturity level.
//
// Consequences: data is lost on restart (single process); the store interface
// below is the seam for a real database (e.g. pgx + PostgreSQL) later. In-
// process rate limiting is demo-grade exactly like Stack 01's Caffeine cache:
// production deployments must enforce limits at the edge.
package store

import (
	"strings"
	"sync"
	"time"

	"golang.org/x/crypto/bcrypt"
)

// User is a stored account. PasswordHash is a bcrypt hash and is never
// serialized to any API response.
type User struct {
	Email        string
	PasswordHash string
	CreatedAt    time.Time
}

// Session is a server-side session. The ID is a random 256-bit opaque value
// (crypto/rand), stored server-side; clients hold only the cookie.
type Session struct {
	ID        string
	Email     string
	CreatedAt time.Time
	ExpiresAt time.Time
}

// Store is the persistence seam. It is safe for concurrent use.
type Store interface {
	CreateUser(email, passwordHash string) (*User, error)
	UserByEmail(email string) (*User, bool)
	CreateSession(email string, ttl time.Duration) (*Session, error)
	SessionByID(id string) (*Session, bool)
	DeleteSession(id string)
}

// Memory is an in-memory Store guarded by a single RWMutex.
type Memory struct {
	mu       sync.RWMutex
	users    map[string]*User
	sessions map[string]*Session
	now      func() time.Time
}

// NewMemory creates an empty in-memory store. The clock can be overridden in
// tests (nil means time.Now).
func NewMemory(now func() time.Time) *Memory {
	if now == nil {
		now = time.Now
	}
	return &Memory{
		users:    make(map[string]*User),
		sessions: make(map[string]*Session),
		now:      now,
	}
}

// NormalizeEmail lowercases and trims the email; it is the identity key.
func NormalizeEmail(email string) string {
	return strings.ToLower(strings.TrimSpace(email))
}

// CreateUser inserts a user. The caller must have validated the input and
// checked uniqueness; ErrEmailTaken is returned if the email already exists.
func (m *Memory) CreateUser(email, passwordHash string) (*User, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	key := NormalizeEmail(email)
	if _, exists := m.users[key]; exists {
		return nil, ErrEmailTaken
	}
	u := &User{Email: key, PasswordHash: passwordHash, CreatedAt: m.now()}
	m.users[key] = u
	return u, nil
}

// UserByEmail looks a user up by normalized email.
func (m *Memory) UserByEmail(email string) (*User, bool) {
	m.mu.RLock()
	defer m.mu.RUnlock()
	u, ok := m.users[NormalizeEmail(email)]
	return u, ok
}

// CreateSession mints a new server-side session with a crypto/rand id.
func (m *Memory) CreateSession(email string, ttl time.Duration) (*Session, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	id, err := newSessionID()
	if err != nil {
		return nil, err
	}
	now := m.now()
	s := &Session{ID: id, Email: NormalizeEmail(email), CreatedAt: now, ExpiresAt: now.Add(ttl)}
	m.sessions[id] = s
	return s, nil
}

// SessionByID returns the session if it exists and is not expired. Expired
// sessions are removed lazily on access.
func (m *Memory) SessionByID(id string) (*Session, bool) {
	m.mu.Lock()
	defer m.mu.Unlock()
	s, ok := m.sessions[id]
	if !ok {
		return nil, false
	}
	if m.now().After(s.ExpiresAt) {
		delete(m.sessions, id)
		return nil, false
	}
	return s, true
}

// DeleteSession invalidates a session server-side (logout).
func (m *Memory) DeleteSession(id string) {
	m.mu.Lock()
	defer m.mu.Unlock()
	delete(m.sessions, id)
}

// HashPassword hashes with bcrypt (default cost 10). The cost is deliberately
// the library default: higher costs must be a documented, measured decision.
func HashPassword(plain string) (string, error) {
	hash, err := bcrypt.GenerateFromPassword([]byte(plain), bcrypt.DefaultCost)
	if err != nil {
		return "", err
	}
	return string(hash), nil
}

// CheckPassword compares in constant time inside bcrypt.
func CheckPassword(hash, plain string) bool {
	return bcrypt.CompareHashAndPassword([]byte(hash), []byte(plain)) == nil
}
