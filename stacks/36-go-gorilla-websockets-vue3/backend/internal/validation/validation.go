// Package validation contains the shared input rules for the four-screen
// contract. The limits and messages mirror Stack 04 / Stack 01 so every
// stack in the repository behaves identically at this boundary.
package validation

import (
	"regexp"
	"strings"
)

// Limits (enforced server-side; the client may repeat them but the server is
// the authority).
const (
	MaxEmailLen    = 254
	MinPasswordLen = 10
	MaxPasswordLen = 128
)

// emailPattern is deliberately simple and strict about shape; deliverability
// is not our job. The same pattern is used by Stack 01.
var emailPattern = regexp.MustCompile(`^[^@\s]+@[^@\s]+\.[^@\s]+$`)

// ValidateEmail returns nil when the email is well-formed and within bounds.
func ValidateEmail(email string) error {
	if len(email) == 0 || len(email) > MaxEmailLen {
		return ErrInvalidEmail
	}
	if !emailPattern.MatchString(email) {
		return ErrInvalidEmail
	}
	return nil
}

// ValidatePassword enforces the documented policy: 10..128 chars with at
// least one letter and one digit. Message-identical failures prevent
// field-level enumeration on register.
func ValidatePassword(password string) error {
	if len(password) < MinPasswordLen || len(password) > MaxPasswordLen {
		return ErrWeakPassword
	}
	hasLetter, hasDigit := false, false
	for _, r := range password {
		switch {
		case r >= 'A' && r <= 'Z', r >= 'a' && r <= 'z':
			hasLetter = true
		case r >= '0' && r <= '9':
			hasDigit = true
		}
	}
	if !hasLetter || !hasDigit {
		return ErrWeakPassword
	}
	return nil
}

// NormalizeEmail is the canonical normalization (lowercase + trim); it is the
// identity key everywhere.
func NormalizeEmail(email string) string {
	return strings.ToLower(strings.TrimSpace(email))
}
