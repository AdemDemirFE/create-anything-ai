// handlers.go — JSON API (/api/v1/**) handlers on the repository envelope
// (docs/PRODUCT_REQUIREMENTS.md section 7).
//
// Session auth is the RequireSession middleware; protected endpoints answer
// 401 UNAUTHORIZED before any handler logic runs. Every response carries an
// X-Request-Id header AND the same id inside meta.request_id (set by the
// WithRequestID middleware; an inbound X-Request-Id is honored when valid —
// printable ASCII, 8..128 chars — for correlation across hops).
package api

import (
	"encoding/json"
	"errors"
	"net/http"
	"time"

	"github.com/AdemDemirFE/create-anything-ai/stacks/36-go-gorilla-websockets-vue3/backend/internal/algorithm"
	"github.com/AdemDemirFE/create-anything-ai/stacks/36-go-gorilla-websockets-vue3/backend/internal/auth"
	"github.com/AdemDemirFE/create-anything-ai/stacks/36-go-gorilla-websockets-vue3/backend/internal/envelope"
)

// CookieName is the session cookie (HttpOnly, SameSite=Lax; Secure when
// COOKIE_SECURE=true behind TLS).
const CookieName = "STACK36_SESSION"

// MaxBodyBytes caps every API request body (256KB).
const MaxBodyBytes = 256 * 1024

// Handlers holds the API dependencies.
type Handlers struct {
	Auth *auth.Service
	// SecureCookies is read per request (set once at app wiring).
	SecureCookies bool
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

// decodeJSON parses a bounded JSON body. Bodies larger than MaxBodyBytes are
// rejected (413) and malformed JSON is a VALIDATION_ERROR.
func decodeJSON(w http.ResponseWriter, r *http.Request, dst any) bool {
	r.Body = http.MaxBytesReader(w, r.Body, MaxBodyBytes)
	dec := json.NewDecoder(r.Body)
	if err := dec.Decode(dst); err != nil {
		var tooBig *http.MaxBytesError
		if errors.As(err, &tooBig) {
			envelope.Fail(w, r, http.StatusRequestEntityTooLarge, "INPUT_TOO_LARGE",
				"Request body exceeds the maximum allowed size.")
			return false
		}
		envelope.Fail(w, r, http.StatusBadRequest, "VALIDATION_ERROR",
			"The request contains invalid fields.")
		return false
	}
	return true
}

// Register creates an account (201). Validation errors are field-level;
// duplicates are 409 EMAIL_TAKEN.
func (h *Handlers) Register(w http.ResponseWriter, r *http.Request) {
	var req RegisterRequest
	if !decodeJSON(w, r, &req) {
		return
	}
	email, err := h.Auth.Register(req.Email, req.Password)
	if err != nil {
		h.mapAuthError(w, r, err)
		return
	}
	envelope.Created(w, r, UserView{Email: email})
}

// Login authenticates and sets the session cookie. 429 carries Retry-After.
func (h *Handlers) Login(w http.ResponseWriter, r *http.Request) {
	var req LoginRequest
	if !decodeJSON(w, r, &req) {
		return
	}
	sess, err := h.Auth.Login(req.Email, req.Password, r.RemoteAddr, r.Header.Get("X-Forwarded-For"))
	if err != nil {
		h.mapAuthError(w, r, err)
		return
	}
	setSessionCookie(w, sess.ID, sess.ExpiresAt, h.SecureCookies)
	envelope.OK(w, r, UserView{Email: sess.Email})
}

// Logout invalidates the session server-side and clears the cookie. It is
// idempotent: calling it without a session still succeeds.
func (h *Handlers) Logout(w http.ResponseWriter, r *http.Request) {
	if ck, err := r.Cookie(CookieName); err == nil && ck.Value != "" {
		h.Auth.Logout(ck.Value)
	}
	clearSessionCookie(w, h.SecureCookies)
	envelope.OK(w, r, map[string]bool{"logout": true})
}

// Me returns the authenticated profile.
func (h *Handlers) Me(w http.ResponseWriter, r *http.Request) {
	envelope.OK(w, r, UserView{Email: EmailFrom(r.Context())})
}

// Home requires a session and returns the profile plus deterministic, safe
// sample metrics.
func (h *Handlers) Home(w http.ResponseWriter, r *http.Request) {
	envelope.OK(w, r, HomeData{
		Email: EmailFrom(r.Context()),
		Metrics: []Metric{
			{Label: "Active sessions", Value: "1", Unit: "session"},
			{Label: "Algorithms available", Value: "4", Unit: "items"},
			{Label: "Uptime", Value: "demo", Unit: "reference"},
		},
		ServerTime: time.Now().UTC().Format(time.RFC3339),
	})
}

// AlgorithmCatalog lists the fixed, safe algorithms (session required).
func (h *Handlers) AlgorithmCatalog(w http.ResponseWriter, r *http.Request) {
	envelope.OK(w, r, algorithm.Catalog)
}

// AlgorithmRun executes one fixed bounded algorithm (session required) and
// publishes a run.completed broadcast through the hand-written hub.
func (h *Handlers) AlgorithmRun(w http.ResponseWriter, r *http.Request) {
	var req AlgorithmRunRequest
	if !decodeJSON(w, r, &req) {
		return
	}
	result, err := algorithm.Run(req.AlgorithmID, req.Input)
	if err != nil {
		h.mapAlgorithmError(w, r, err)
		return
	}
	if publisher := PublisherFrom(r.Context()); publisher != nil {
		publisher.PublishRun(EmailFrom(r.Context()), result)
	}
	envelope.OKMeasured(w, r, result, time.Now())
}

// mapAuthError converts auth use-case errors into envelope responses.
func (h *Handlers) mapAuthError(w http.ResponseWriter, r *http.Request, err error) {
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
		envelope.FailWithDetails(w, r, http.StatusBadRequest, "VALIDATION_ERROR",
			"The request contains invalid fields.", details)
	case errors.Is(err, auth.ErrEmailTaken):
		envelope.Fail(w, r, http.StatusConflict, "EMAIL_TAKEN",
			"An account with this email already exists.")
	case errors.Is(err, auth.ErrRateLimited):
		w.Header().Set("Retry-After", itoa(h.Auth.RetryAfterSeconds()))
		envelope.Fail(w, r, http.StatusTooManyRequests, "RATE_LIMITED",
			"Too many failed attempts. Please wait a minute and try again.")
	case errors.Is(err, auth.ErrInvalidCreds):
		// Identical for unknown email and wrong password: no enumeration.
		envelope.Fail(w, r, http.StatusUnauthorized, "INVALID_CREDENTIALS",
			"Invalid email or password.")
	default:
		envelope.Fail(w, r, http.StatusInternalServerError, "INTERNAL_ERROR",
			"An unexpected error occurred.")
	}
}

// mapAlgorithmError converts algorithm engine errors into envelope responses.
func (h *Handlers) mapAlgorithmError(w http.ResponseWriter, r *http.Request, err error) {
	switch {
	case errors.Is(err, algorithm.ErrUnknownAlgorithm):
		envelope.Fail(w, r, http.StatusBadRequest, "UNKNOWN_ALGORITHM",
			"Unknown algorithm.")
	case errors.Is(err, algorithm.ErrInputTooLarge):
		envelope.Fail(w, r, http.StatusRequestEntityTooLarge, "INPUT_TOO_LARGE",
			"Input exceeds the maximum allowed length.")
	case errors.Is(err, algorithm.ErrInvalidInput):
		envelope.Fail(w, r, http.StatusBadRequest, "VALIDATION_ERROR",
			"The input is invalid for this algorithm.")
	default:
		envelope.Fail(w, r, http.StatusInternalServerError, "INTERNAL_ERROR",
			"An unexpected error occurred.")
	}
}

// itoa is a tiny allocation-light int → string for header values.
func itoa(v int) string {
	if v == 0 {
		return "0"
	}
	neg := v < 0
	if neg {
		v = -v
	}
	var buf [20]byte
	i := len(buf)
	for v > 0 {
		i--
		buf[i] = byte('0' + v%10)
		v /= 10
	}
	if neg {
		i--
		buf[i] = '-'
	}
	return string(buf[i:])
}
