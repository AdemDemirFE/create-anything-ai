// Package store errors: stable sentinel errors mapped to envelope codes.
package store

import "errors"

// ErrEmailTaken maps to HTTP 409 EMAIL_TAKEN.
var ErrEmailTaken = errors.New("email already registered")
