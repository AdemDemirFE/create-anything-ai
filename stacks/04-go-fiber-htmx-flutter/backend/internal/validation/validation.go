// Package validation contains the shared input rules for the four-screen
// contract. The same checks run for the JSON API and the htmx web forms so
// both surfaces behave identically.
package validation

import (
	"regexp"
	"strings"
)

// Limits (documented in ARCHITECTURE.md and enforced server-side; the client
// may repeat them but the server is the authority).
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

// FieldDetails builds the envelope details list for a rejected field.
func FieldDetails(field, code string) []string {
	return []string{field + "|" + code}
}

// NormalizeEmail is a convenience re-export so handlers share one canonical
// normalization (lowercase + trim) with the store.
func NormalizeEmail(email string) string {
	return strings.ToLower(strings.TrimSpace(email))
}
