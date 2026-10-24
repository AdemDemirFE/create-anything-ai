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
//
// Correlation: the request id lives in the request context (WithRequestID /
// RequestIDFrom). The api middleware validates or mints it and echoes it as
// the X-Request-Id response header; every envelope's meta.request_id carries
// THE SAME id, so header and body never disagree.
//
// Stack-36 note: unlike Stack 04 (Fiber context-bound helpers), this envelope
// is written against net/http directly — the çırak (hand-rolled) paradigm of
// this stack extends to the response helpers too.
package envelope

import (
	"context"
	"encoding/json"
	"net/http"
	"time"

	"github.com/google/uuid"
)

type ctxKey int

const ctxRequestID ctxKey = iota

// WithRequestID stores the correlation id on a request context.
func WithRequestID(ctx context.Context, id string) context.Context {
	return context.WithValue(ctx, ctxRequestID, id)
}

// RequestIDFrom reads the correlation id ("" when unset).
func RequestIDFrom(ctx context.Context) string {
	id, _ := ctx.Value(ctxRequestID).(string)
	return id
}

// NewRequestID mints an opaque correlation id (UUID v4).
func NewRequestID() string { return uuid.NewString() }

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

func meta(r *http.Request) Meta {
	id := RequestIDFrom(r.Context())
	if id == "" {
		id = NewRequestID()
	}
	return Meta{
		Timestamp: time.Now().UTC().Format(time.RFC3339Nano),
		RequestID: id,
	}
}

func metaMeasured(r *http.Request, started time.Time) Meta {
	ms := float64(time.Since(started).Nanoseconds()) / 1e6
	rounded := float64(int(ms*10+0.5)) / 10
	m := meta(r)
	m.ExecutionMS = &rounded
	return m
}

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}

// OK writes a success envelope (no execution_ms: not meaningful here).
func OK(w http.ResponseWriter, r *http.Request, data any) {
	writeJSON(w, http.StatusOK, Envelope{Success: true, Data: data, Error: nil, Meta: meta(r)})
}

// Created writes a 201 success envelope.
func Created(w http.ResponseWriter, r *http.Request, data any) {
	writeJSON(w, http.StatusCreated, Envelope{Success: true, Data: data, Error: nil, Meta: meta(r)})
}

// OKMeasured writes a success envelope whose execution_ms was measured with a
// monotonic clock (time.Since over a captured start time).
func OKMeasured(w http.ResponseWriter, r *http.Request, data any, started time.Time) {
	writeJSON(w, http.StatusOK, Envelope{Success: true, Data: data, Error: nil, Meta: metaMeasured(r, started)})
}

// Fail writes an error envelope with the given HTTP status.
func Fail(w http.ResponseWriter, r *http.Request, status int, code, message string) {
	FailWithDetails(w, r, status, code, message, nil)
}

// FailWithDetails writes an error envelope with optional field-level details.
func FailWithDetails(w http.ResponseWriter, r *http.Request, status int, code, message string, details []FieldError) {
	writeJSON(w, status, Envelope{
		Success: false,
		Data:    nil,
		Error:   &ErrorBody{Code: code, Message: message, Details: details},
		Meta:    meta(r),
	})
}
