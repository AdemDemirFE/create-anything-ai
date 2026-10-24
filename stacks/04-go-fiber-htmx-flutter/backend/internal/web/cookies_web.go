// Package web — session cookie helpers for the server-rendered pages.
// Same flags as the API cookie: HttpOnly, SameSite=Lax, Secure per mode.
package web

import (
	"time"

	"github.com/gofiber/fiber/v3"

	"github.com/AdemDemirFE/create-anything-ai/stacks/04-go-fiber-htmx-flutter/backend/internal/api"
)

func setWebSessionCookie(c fiber.Ctx, id string, expires time.Time, secure bool) {
	c.Cookie(&fiber.Cookie{
		Name:     api.CookieName,
		Value:    id,
		Path:     "/",
		Expires:  expires,
		HTTPOnly: true,
		SameSite: "Lax",
		Secure:   secure,
	})
}

func clearWebSessionCookie(c fiber.Ctx, secure bool) {
	c.Cookie(&fiber.Cookie{
		Name:     api.CookieName,
		Value:    "",
		Path:     "/",
		Expires:  time.Unix(0, 0),
		HTTPOnly: true,
		SameSite: "Lax",
		Secure:   secure,
	})
}
