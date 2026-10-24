package app

import (
	"errors"

	"github.com/gofiber/fiber/v3"

	"github.com/AdemDemirFE/create-anything-ai/stacks/04-go-fiber-htmx-flutter/backend/internal/envelope"
)

// errorsAs is a tiny indirection so the error helper stays in one file.
func errorsAs(err error, target **fiber.Error) bool {
	return errors.As(err, target)
}

// OKEnvelope re-exports envelope.OK for inline handlers in app.go.
func OKEnvelope(c fiber.Ctx, data any) error { return envelope.OK(c, data) }

// EnvelopeError renders a generic envelope error for unexpected failures on
// API paths (stable code INTERNAL_ERROR, safe message, no stack trace).
func EnvelopeError(c fiber.Ctx, status int) error {
	return envelope.Fail(c, status, "INTERNAL_ERROR", "An unexpected error occurred.")
}

