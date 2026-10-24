// Package api implements the JSON API (/api/v1/**) handlers on the repository
// envelope (docs/PRODUCT_REQUIREMENTS.md section 7). Session auth is a single
// middleware; protected endpoints answer 401 UNAUTHORIZED before any handler
// logic runs.
package api

import (
	"errors"
	"time"

	"github.com/gofiber/fiber/v3"

	"github.com/AdemDemirFE/create-anything-ai/stacks/04-go-fiber-htmx-flutter/backend/internal/algorithm"
	"github.com/AdemDemirFE/create-anything-ai/stacks/04-go-fiber-htmx-flutter/backend/internal/auth"
	"github.com/AdemDemirFE/create-anything-ai/stacks/04-go-fiber-htmx-flutter/backend/internal/envelope"
)

// CookieName is the session cookie (HttpOnly, SameSite=Lax; Secure when
// COOKIE_SECURE=true behind TLS).
const CookieName = "STACK04_SESSION"

// Handlers holds the API dependencies.
type Handlers struct {
	Auth *auth.Service
	// SecureCookies is read per request (set once at app wiring).
	SecureCookies func() bool
}

// RegisterRequest is the register body.
type RegisterRequest struct {
	Email    string `json:"email"`
	Password string `json:"password"`
}

// LoginRequest is the login body.
type LoginRequest struct {
	Email    string `json:"email"`
	Password string `json:"password"`
}

// UserView is the safe user representation (never the hash).
type UserView struct {
	Email string `json:"email"`
}

// HomeData is the protected home payload: profile + safe sample metrics.
type HomeData struct {
	Email      string   `json:"email"`
	Metrics    []Metric `json:"metrics"`
	ServerTime string   `json:"server_time"`
}

// Metric is one safe sample metric.
type Metric struct {
	Label string `json:"label"`
	Value string `json:"value"`
	Unit  string `json:"unit"`
}

// AlgorithmRunRequest is the run body.
type AlgorithmRunRequest struct {
	AlgorithmID string `json:"algorithm_id"`
	Input       string `json:"input"`
}

// Register creates an account (201). Validation errors are field-level;
// duplicates are 409 EMAIL_TAKEN without leaking whether the address exists
// beyond that explicit signal (registration inherently reveals it).
func (h *Handlers) Register(c fiber.Ctx) error {
	var req RegisterRequest
	if err := c.Bind().Body(&req); err != nil {
		return envelope.Fail(c, fiber.StatusBadRequest, "VALIDATION_ERROR",
			"The request contains invalid fields.")
	}
	email, err := h.Auth.Register(req.Email, req.Password)
	if err != nil {
		return h.mapAuthError(c, err)
	}
	return c.Status(fiber.StatusCreated).JSON(envelope.Envelope{
		Success: true,
		Data:    UserView{Email: email},
		Error:   nil,
		Meta:    envelope.NowMeta(),
	})
}

// Login authenticates and sets the session cookie. 429 carries Retry-After.
func (h *Handlers) Login(c fiber.Ctx) error {
	var req LoginRequest
	if err := c.Bind().Body(&req); err != nil {
		return envelope.Fail(c, fiber.StatusBadRequest, "VALIDATION_ERROR",
			"The request contains invalid fields.")
	}
	sess, err := h.Auth.Login(req.Email, req.Password, c.IP(), c.Get("X-Forwarded-For"))
	if err != nil {
		return h.mapAuthError(c, err)
	}
	if sess == nil {
		return envelope.Fail(c, fiber.StatusInternalServerError, "INTERNAL_ERROR",
			"Login produced no session.")
	}
	setSessionCookie(c, sess.ID, sess.ExpiresAt, h.SecureCookies())
	return envelope.OK(c, UserView{Email: sess.Email})
}

// Logout invalidates the session server-side and clears the cookie. It is
// idempotent: calling it without a session still succeeds.
func (h *Handlers) Logout(c fiber.Ctx) error {
	if id := c.Cookies(CookieName); id != "" {
		h.Auth.Logout(id)
	}
	clearSessionCookie(c, h.SecureCookies())
	return envelope.OK(c, fiber.Map{"logout": true})
}

// Home requires a session (middleware enforces 401) and returns the profile
// plus deterministic, safe sample metrics.
func (h *Handlers) Home(c fiber.Ctx) error {
	email := SessionEmail(c)
	return envelope.OK(c, HomeData{
		Email: email,
		Metrics: []Metric{
			{Label: "Active sessions", Value: "1", Unit: "session"},
			{Label: "Algorithms available", Value: "4", Unit: "items"},
			{Label: "Uptime", Value: "demo", Unit: "reference"},
		},
		ServerTime: time.Now().UTC().Format(time.RFC3339),
	})
}

// AlgorithmCatalog lists the fixed, safe algorithms (session required).
func (h *Handlers) AlgorithmCatalog(c fiber.Ctx) error {
	return envelope.OK(c, algorithm.Catalog)
}

// AlgorithmRun executes one fixed bounded algorithm (session required).
func (h *Handlers) AlgorithmRun(c fiber.Ctx) error {
	var req AlgorithmRunRequest
	if err := c.Bind().Body(&req); err != nil {
		return envelope.Fail(c, fiber.StatusBadRequest, "VALIDATION_ERROR",
			"The request contains invalid fields.")
	}
	result, err := algorithm.Run(req.AlgorithmID, req.Input, nil)
	if err != nil {
		return h.mapAlgorithmError(c, err)
	}
	return envelope.OKMeasured(c, result, time.Now())
}

// RequireSession is the middleware guarding every protected endpoint. It
// answers 401 UNAUTHORIZED (envelope) when the cookie is missing, unknown,
// or expired, and stores the email in locals for handlers.
func (h *Handlers) RequireSession(c fiber.Ctx) error {
	id := c.Cookies(CookieName)
	email, err := h.Auth.SessionUser(id)
	if err != nil {
		return envelope.Fail(c, fiber.StatusUnauthorized, "UNAUTHORIZED",
			"Authentication is required.")
	}
	c.Locals("email", email)
	return c.Next()
}

// SessionEmail reads the email stored by RequireSession.
func SessionEmail(c fiber.Ctx) string {
	email, _ := c.Locals("email").(string)
	return email
}

// mapAuthError converts auth use-case errors into envelope responses.
func (h *Handlers) mapAuthError(c fiber.Ctx, err error) error {
	var ve *auth.ValidationError
	switch {
	case errors.As(err, &ve):
		details := make([]envelope.FieldError, 0, len(ve.Fields))
		for _, f := range ve.Fields {
			code := f.Code
			if f.Field == "password" {
				code = "WEAK_PASSWORD"
			}
			details = append(details, envelope.FieldError{Field: f.Field, Code: code})
		}
		return envelope.FailWithDetails(c, fiber.StatusBadRequest, "VALIDATION_ERROR",
			"The request contains invalid fields.", details)
	case errors.Is(err, auth.ErrEmailTaken):
		return envelope.Fail(c, fiber.StatusConflict, "EMAIL_TAKEN",
			"An account with this email already exists.")
	case errors.Is(err, auth.ErrRateLimited):
		c.Set("Retry-After", itoa(h.Auth.RetryAfterSeconds()))
		return envelope.Fail(c, fiber.StatusTooManyRequests, "RATE_LIMITED",
			"Too many failed attempts. Please wait a minute and try again.")
	case errors.Is(err, auth.ErrInvalidCreds):
		// Identical for unknown email and wrong password: no enumeration.
		return envelope.Fail(c, fiber.StatusUnauthorized, "INVALID_CREDENTIALS",
			"Invalid email or password.")
	default:
		return envelope.Fail(c, fiber.StatusInternalServerError, "INTERNAL_ERROR",
			"An unexpected error occurred.")
	}
}

// mapAlgorithmError converts algorithm engine errors into envelope responses.
func (h *Handlers) mapAlgorithmError(c fiber.Ctx, err error) error {
	switch {
	case errors.Is(err, algorithm.ErrUnknownAlgorithm):
		return envelope.Fail(c, fiber.StatusBadRequest, "UNKNOWN_ALGORITHM",
			"Unknown algorithm.")
	case errors.Is(err, algorithm.ErrInputTooLarge):
		return envelope.Fail(c, fiber.StatusRequestEntityTooLarge, "INPUT_TOO_LARGE",
			"Input exceeds the maximum allowed length.")
	case errors.Is(err, algorithm.ErrInvalidInput):
		return envelope.Fail(c, fiber.StatusBadRequest, "VALIDATION_ERROR",
			"The input is invalid for this algorithm.")
	default:
		return envelope.Fail(c, fiber.StatusInternalServerError, "INTERNAL_ERROR",
			"An unexpected error occurred.")
	}
}
