// Package envelope implements the repository-wide API response envelope from
// docs/PRODUCT_REQUIREMENTS.md section 7:
//
//	{ "success": true,  "data": {...}, "error": null,
//	  "meta": { "timestamp": "...", "execution_ms": 2.4, "request_id": "..." } }
//	{ "success": false, "data": null,
//	  "error": { "code": "...", "message": "...", "details": [...] },
//	  "meta": { ... } }
//
// Rules enforced here: errors carry a stable machine-readable code and a safe
// message; stack traces never leave the process; execution_ms is only set
// where measurement is meaningful and never fabricated.
package envelope

import (
	"time"

	"github.com/gofiber/fiber/v3"
	"github.com/google/uuid"
)

// FieldError is one field-level validation detail.
type FieldError struct {
	Field string `json:"field"`
	Code  string `json:"code"`
}

// ErrorBody is the stable machine-readable error object.
type ErrorBody struct {
	Code    string       `json:"code"`
	Message string       `json:"message"`
	Details []FieldError `json:"details,omitempty"`
}

// Meta carries correlation and optional measurement.
type Meta struct {
	Timestamp   string   `json:"timestamp"`
	ExecutionMS *float64 `json:"execution_ms"`
	RequestID   string   `json:"request_id"`
}

// Envelope is the single response shape for every JSON API response.
type Envelope struct {
	Success bool       `json:"success"`
	Data    any        `json:"data"`
	Error   *ErrorBody `json:"error"`
	Meta    Meta       `json:"meta"`
}

// nowMeta builds Meta with the current UTC timestamp and a fresh opaque
// correlation id. Exported as NowMeta for handlers that compose their own
// response bodies (e.g. 201 Created).
func NowMeta() Meta {
	return nowMeta()
}

func nowMeta() Meta {
	return Meta{
		Timestamp:   time.Now().UTC().Format(time.RFC3339Nano),
		ExecutionMS: nil,
		RequestID:   uuid.NewString(),
	}
}

// measuredMeta builds Meta with a duration measured by a monotonic clock.
func measuredMeta(started time.Time) Meta {
	ms := float64(time.Since(started).Nanoseconds()) / 1e6
	rounded := float64(int(ms*10+0.5)) / 10
	m := nowMeta()
	m.ExecutionMS = &rounded
	return m
}

// OK writes a success envelope. executionMS may be nil when measurement is
// not meaningful for the endpoint.
func OK(c fiber.Ctx, data any) error {
	return c.JSON(Envelope{Success: true, Data: data, Error: nil, Meta: nowMeta()})
}

// OKMeasured writes a success envelope whose execution_ms was measured with a
// monotonic clock (time.Since over a captured start time).
func OKMeasured(c fiber.Ctx, data any, started time.Time) error {
	return c.JSON(Envelope{Success: true, Data: data, Error: nil, Meta: measuredMeta(started)})
}

// Fail writes an error envelope with the given HTTP status.
func Fail(c fiber.Ctx, status int, code, message string) error {
	return FailWithDetails(c, status, code, message, nil)
}

// FailWithDetails writes an error envelope with optional field-level details.
func FailWithDetails(c fiber.Ctx, status int, code, message string, details []FieldError) error {
	return c.Status(status).JSON(Envelope{
		Success: false,
		Data:    nil,
		Error:   &ErrorBody{Code: code, Message: message, Details: details},
		Meta:    nowMeta(),
	})
}
