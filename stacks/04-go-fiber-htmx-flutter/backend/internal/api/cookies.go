package api

import (
	"strconv"
	"time"

	"github.com/gofiber/fiber/v3"

	"github.com/AdemDemirFE/create-anything-ai/stacks/04-go-fiber-htmx-flutter/backend/internal/envelope"
)

// NowMeta re-exports the envelope constructor for handlers that build their
// own 201 bodies.
var NowMeta = envelope.NowMeta

// setSessionCookie writes the session cookie: HttpOnly, SameSite=Lax, path /,
// Secure per deployment mode.
func setSessionCookie(c fiber.Ctx, id string, expires time.Time, secure bool) {
	c.Set("Set-Cookie", sessionCookieString(id, expires, secure))
}

// sessionCookieString builds the Set-Cookie header value manually so the
// flags (HttpOnly, SameSite, Expires) are exactly as documented.
func sessionCookieString(id string, expires time.Time, secure bool) string {
	v := CookieName + "=" + id +
		"; Path=/; Expires=" + expires.UTC().Format("Mon, 02 Jan 2006 15:04:05 GMT") +
		"; Max-Age=" + itoa(int(time.Until(expires).Seconds())) +
		"; HttpOnly; SameSite=Lax"
	if secure {
		v += "; Secure"
	}
	return v
}

// clearSessionCookie expires the session cookie immediately.
func clearSessionCookie(c fiber.Ctx, secure bool) {
	c.Set("Set-Cookie", CookieName+"=; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT; Max-Age=0; HttpOnly; SameSite=Lax")
}

func itoa(n int) string { return strconv.Itoa(n) }
