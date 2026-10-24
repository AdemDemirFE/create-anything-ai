// cookies.go — session cookie helpers (net/http, explicit flags so the
// contract is exactly what the tests assert).
package api

import (
	"net/http"
	"time"
)

// setSessionCookie writes the session cookie with the documented flags:
// HttpOnly + SameSite=Lax, Path=/, expiry at session end, Secure per config.
func setSessionCookie(w http.ResponseWriter, id string, expires time.Time, secure bool) {
	http.SetCookie(w, &http.Cookie{
		Name:     CookieName,
		Value:    id,
		Path:     "/",
		Expires:  expires,
		HttpOnly: true,
		Secure:   secure,
		SameSite: http.SameSiteLaxMode,
	})
}

// clearSessionCookie expires the cookie immediately (logout).
func clearSessionCookie(w http.ResponseWriter, secure bool) {
	http.SetCookie(w, &http.Cookie{
		Name:     CookieName,
		Value:    "",
		Path:     "/",
		MaxAge:   -1,
		HttpOnly: true,
		Secure:   secure,
		SameSite: http.SameSiteLaxMode,
	})
}
