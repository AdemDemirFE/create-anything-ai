package validation

import "errors"

// Stable validation failures. They map 1:1 to envelope codes; the messages
// are safe (no internal details).
var (
	ErrInvalidEmail = errors.New("email is not a valid address")
	ErrWeakPassword = errors.New("password does not meet the policy")
	ErrRequired     = errors.New("this field is required")
)
