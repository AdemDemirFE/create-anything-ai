// Package validation errors: stable, message-identical codes.
package validation

import "errors"

var (
	ErrInvalidEmail = errors.New("invalid email format")
	ErrWeakPassword = errors.New("weak password")
)
