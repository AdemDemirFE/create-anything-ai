package auth

import (
	"errors"
	"testing"
	"time"

	"github.com/AdemDemirFE/create-anything-ai/stacks/04-go-fiber-htmx-flutter/backend/internal/clientip"
	"github.com/AdemDemirFE/create-anything-ai/stacks/04-go-fiber-htmx-flutter/backend/internal/throttle"
)

func newTestService() *Service {
	return New(
		newStoreMemory(),
		throttle.New(throttle.Default(), nil),
		clientip.New(nil),
		nil,
	)
}

// TestRegisterAndLoginHappyPath covers the core journey at the service level.
func TestRegisterAndLoginHappyPath(t *testing.T) {
	s := newTestService()
	if _, err := s.Register("User@Example.com ", "Password123"); err != nil {
		t.Fatalf("register: %v", err)
	}
	sess, err := s.Login("user@example.com", "Password123", "1.2.3.4:5000", "")
	if err != nil {
		t.Fatalf("login: %v", err)
	}
	email, err := s.SessionUser(sess.ID)
	if err != nil || email != "user@example.com" {
		t.Fatalf("session user = %q, %v", email, err)
	}
}

// TestLoginThrottleByIPAndEmail mirrors the Stack 01 review finding: rotating
// spoofed X-Forwarded-For values must NOT reset the counter while XFF is not
// trusted; the identity is the TCP peer.
func TestLoginThrottleByIPAndEmail(t *testing.T) {
	s := newTestService()
	// Burn the budget with failed logins (default limit: 10).
	for i := 0; i < 10; i++ {
		if _, err := s.Login("victim@example.com", "WrongPass123", "9.9.9.9:1000", ""); !errors.Is(err, ErrInvalidCreds) {
			t.Fatalf("attempt %d: expected ErrInvalidCreds, got %v", i+1, err)
		}
	}
	// 11th failure is rate limited even with a brand-new spoofed XFF.
	if _, err := s.Login("victim@example.com", "WrongPass123", "9.9.9.9:1000", "1.1.1.1, 2.2.2.2"); !errors.Is(err, ErrRateLimited) {
		t.Fatalf("expected ErrRateLimited, got %v", err)
	}
	// Same email from another IP is a different bucket.
	if _, err := s.Login("victim@example.com", "WrongPass123", "8.8.8.8:2000", ""); !errors.Is(err, ErrInvalidCreds) {
		t.Fatalf("other IP should be a different bucket, got %v", err)
	}
	// Success clears the tally for that identity pair.
	if _, err := s.Register("victim@example.com", "Password123"); err != nil {
		t.Fatalf("register: %v", err)
	}
	if _, err := s.Login("victim@example.com", "Password123", "8.8.8.8:2000", ""); err != nil {
		t.Fatalf("successful login should clear tally: %v", err)
	}
}

// TestSessionExpiry exercises the store-backed session TTL path.
func TestSessionExpiry(t *testing.T) {
	clock := time.Now()
	mem := newStoreMemoryWithClock(func() time.Time { return clock })
	s := New(mem, throttle.New(throttle.Default(), func() time.Time { return clock }), clientip.New(nil), func() time.Time { return clock })

	if _, err := s.Register("expire@example.com", "Password123"); err != nil {
		t.Fatalf("register: %v", err)
	}
	sess, err := s.Login("expire@example.com", "Password123", "1.1.1.1:1", "")
	if err != nil {
		t.Fatalf("login: %v", err)
	}
	clock = clock.Add(SessionTTL + time.Minute)
	if _, err := s.SessionUser(sess.ID); !errors.Is(err, ErrSessionExpired) {
		t.Fatalf("expected ErrSessionExpired after TTL, got %v", err)
	}
}

// TestLogoutInvalidatesServerSide asserts revocation (a stolen old cookie is
// dead after logout).
func TestLogoutInvalidatesServerSide(t *testing.T) {
	s := newTestService()
	if _, err := s.Register("logout@example.com", "Password123"); err != nil {
		t.Fatalf("register: %v", err)
	}
	sess, err := s.Login("logout@example.com", "Password123", "1.1.1.1:1", "")
	if err != nil {
		t.Fatalf("login: %v", err)
	}
	s.Logout(sess.ID)
	if _, err := s.SessionUser(sess.ID); err == nil {
		t.Fatal("session must be invalid after logout")
	}
}

// TestRegisterDuplicateEmailMapsToErrEmailTaken keeps the API contract
// (409 EMAIL_TAKEN) independent of the store error.
func TestRegisterDuplicateEmailMapsToErrEmailTaken(t *testing.T) {
	s := newTestService()
	if _, err := s.Register("dup@example.com", "Password123"); err != nil {
		t.Fatalf("first register: %v", err)
	}
	if _, err := s.Register("DUP@example.com", "Password456"); !errors.Is(err, ErrEmailTaken) {
		t.Fatalf("expected ErrEmailTaken, got %v", err)
	}
}

// TestRegisterValidationAggregatesFieldErrors asserts both bad fields are
// reported together (VALIDATION_ERROR with details).
func TestRegisterValidationAggregatesFieldErrors(t *testing.T) {
	s := newTestService()
	_, err := s.Register("not-an-email", "short")
	var ve *ValidationError
	if !errors.As(err, &ve) {
		t.Fatalf("expected ValidationError, got %v", err)
	}
	if len(ve.Fields) != 2 {
		t.Fatalf("expected 2 field errors, got %d: %+v", len(ve.Fields), ve.Fields)
	}
}
