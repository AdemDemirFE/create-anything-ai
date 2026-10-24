// Package auth implements the register/login/logout use-cases shared by the
// JSON API and the htmx web forms.
//
// AUTH DECISION (documented, mirrors Stack 01):
//
//   - Server-side sessions, not JWT. Sessions are revocable server-side
//     (logout deletes the record), need no refresh machinery at this scope,
//     and the cookie is HttpOnly + SameSite=Lax. Secure is set when TLS
//     terminates in front (COOKIE_SECURE env).
//   - Passwords are bcrypt-hashed; hashes never leave the store.
//   - Unknown email and wrong password return the SAME code and message
//     (INVALID_CREDENTIALS): no account enumeration.
//   - Login rotates nothing (no prior session is honored on the API path);
//     a fresh session id is minted per login from crypto/rand.
//   - FAILED logins are throttled per email+client-IP (pinned window) and
//     map to HTTP 429 + Retry-After. Successes clear the tally.
package auth

import (
	"errors"
	"time"

	"github.com/AdemDemirFE/create-anything-ai/stacks/04-go-fiber-htmx-flutter/backend/internal/clientip"
	"github.com/AdemDemirFE/create-anything-ai/stacks/04-go-fiber-htmx-flutter/backend/internal/store"
	"github.com/AdemDemirFE/create-anything-ai/stacks/04-go-fiber-htmx-flutter/backend/internal/throttle"
	"github.com/AdemDemirFE/create-anything-ai/stacks/04-go-fiber-htmx-flutter/backend/internal/validation"
)

// SessionTTL is re-exported from the store for handler wiring.
const SessionTTL = store.SessionTTL

// Stable error codes surfaced as envelope codes / HTTP statuses.
var (
	ErrEmailTaken       = errors.New("email already registered")
	ErrInvalidCreds     = errors.New("invalid email or password")
	ErrRateLimited      = errors.New("too many failed attempts")
	ErrValidation       = errors.New("validation failed")
	ErrSessionExpired   = errors.New("session expired")
	ErrSessionNotFound  = errors.New("session not found")
)

// FieldError carries one field-level validation detail (field|code).
type FieldError struct {
	Field string
	Code  string
}

// ValidationError carries field-level details for VALIDATION_ERROR.
type ValidationError struct {
	Fields []FieldError
}

func (e *ValidationError) Error() string { return ErrValidation.Error() }

// Service is the auth use-case boundary.
type Service struct {
	store    store.Store
	hasher   func(string) (string, error)
	comparer func(hash, plain string) bool
	limiter  *throttle.Limiter
	resolver *clientip.Resolver
	now      func() time.Time
}

// New builds the auth service. now may be nil (time.Now).
func New(st store.Store, limiter *throttle.Limiter, resolver *clientip.Resolver, now func() time.Time) *Service {
	if now == nil {
		now = time.Now
	}
	return &Service{
		store:    st,
		hasher:   store.HashPassword,
		comparer: store.CheckPassword,
		limiter:  limiter,
		resolver: resolver,
		now:      now,
	}
}

// Register validates input, hashes the password, and creates the account.
// Duplicate emails map to ErrEmailTaken (HTTP 409 EMAIL_TAKEN).
func (s *Service) Register(email, password string) (string, error) {
	email = validation.NormalizeEmail(email)
	var fields []FieldError
	if err := validation.ValidateEmail(email); err != nil {
		fields = append(fields, FieldError{Field: "email", Code: "INVALID_FORMAT"})
	}
	if err := validation.ValidatePassword(password); err != nil {
		fields = append(fields, FieldError{Field: "password", Code: err.Error()})
	}
	if len(fields) > 0 {
		return "", &ValidationError{Fields: fields}
	}

	hash, err := s.hasher(password)
	if err != nil {
		return "", err
	}
	_, err = s.store.CreateUser(email, hash)
	if errors.Is(err, store.ErrEmailTaken) {
		return "", ErrEmailTaken
	}
	return email, err
}

// Login authenticates and returns a new session. Failures are throttled per
// email+IP: exceeding the limit returns ErrRateLimited BEFORE credential
// checking (the limiter counts the attempt atomically).
func (s *Service) Login(email, password, remoteAddr, xff string) (*store.Session, error) {
	email = validation.NormalizeEmail(email)
	key := email + "|" + s.resolver.ClientIP(remoteAddr, xff)

	if !s.limiter.Allow(key) {
		return nil, ErrRateLimited
	}

	user, ok := s.store.UserByEmail(email)
	if !ok || !s.comparer(user.PasswordHash, password) {
		// Identical code+message for unknown email vs wrong password.
		return nil, ErrInvalidCreds
	}

	// Success: clear the failure tally for this identity pair.
	s.limiter.Clear(key)
	return s.store.CreateSession(email, SessionTTL)
}

// Logout invalidates the session server-side. Missing sessions are not an
// error (logout is idempotent for the client).
func (s *Service) Logout(sessionID string) {
	if sessionID != "" {
		s.store.DeleteSession(sessionID)
	}
}

// SessionUser resolves a session cookie value to the account email.
func (s *Service) SessionUser(sessionID string) (string, error) {
	if sessionID == "" {
		return "", ErrSessionNotFound
	}
	sess, ok := s.store.SessionByID(sessionID)
	if !ok {
		return "", ErrSessionExpired
	}
	return sess.Email, nil
}

// RetryAfterSeconds is advertised with 429 responses.
func (s *Service) RetryAfterSeconds() int { return s.limiter.RetryAfterSeconds() }
