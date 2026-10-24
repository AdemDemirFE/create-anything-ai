package store

import (
	"crypto/rand"
	"encoding/base64"
	"errors"
	"time"
)

// ErrEmailTaken is returned when a duplicate email is created. It maps to the
// stable error code EMAIL_TAKEN (HTTP 409) at the API boundary.
var ErrEmailTaken = errors.New("email already exists")

// SessionTTL is the documented idle session lifetime (30 minutes). Expired
// sessions are deleted on access; logout deletes them immediately.
const SessionTTL = 30 * time.Minute


// newSessionID returns a 256-bit random opaque session id (crypto/rand).
func newSessionID() (string, error) {
	buf := make([]byte, 32)
	if _, err := rand.Read(buf); err != nil {
		return "", err
	}
	return base64.RawURLEncoding.EncodeToString(buf), nil
}
