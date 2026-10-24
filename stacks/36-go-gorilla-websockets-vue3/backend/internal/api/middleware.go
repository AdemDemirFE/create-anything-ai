// middleware.go — request correlation and the auth guard.
//
// X-Request-Id: validated (printable ASCII, 8..128 chars) when supplied;
// otherwise a UUID is minted. The id is echoed as the X-Request-Id response
// header AND carried in every envelope's meta.request_id via the request
// context — header and body never disagree.
package api

import (
	"context"
	"net/http"
	"strings"

	"github.com/AdemDemirFE/create-anything-ai/stacks/36-go-gorilla-websockets-vue3/backend/internal/algorithm"
	"github.com/AdemDemirFE/create-anything-ai/stacks/36-go-gorilla-websockets-vue3/backend/internal/envelope"
)

type ctxKey int

const (
	ctxEmail ctxKey = iota
	ctxPublisher
)

// RunPublisher is the REST → hub push seam (mirrors Stack 35's
// IEventPublisher; here it calls the hand-written hub directly).
type RunPublisher interface {
	PublishRun(email string, result algorithm.RunResult)
}

// WithPublisher stores the run publisher for handlers.
func WithPublisher(ctx context.Context, p RunPublisher) context.Context {
	return context.WithValue(ctx, ctxPublisher, p)
}

// PublisherFrom reads the run publisher (nil when unset).
func PublisherFrom(ctx context.Context) RunPublisher {
	p, _ := ctx.Value(ctxPublisher).(RunPublisher)
	return p
}

// EmailFrom reads the authenticated email stored by RequireSession.
func EmailFrom(ctx context.Context) string {
	email, _ := ctx.Value(ctxEmail).(string)
	return email
}

// validRequestID accepts printable ASCII ids of 8..128 chars (no controls,
// no spaces — header-injection safe).
func validRequestID(id string) bool {
	if len(id) < 8 || len(id) > 128 {
		return false
	}
	for _, r := range id {
		if r < 0x21 || r > 0x7E {
			return false
		}
	}
	return true
}

// WithRequestID validates/mints the correlation id and echoes it in the
// X-Request-Id response header on every response (including errors).
func (h *Handlers) WithRequestID(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		id := strings.TrimSpace(r.Header.Get("X-Request-Id"))
		if !validRequestID(id) {
			id = envelope.NewRequestID()
		}
		w.Header().Set("X-Request-Id", id)
		next.ServeHTTP(w, r.WithContext(envelope.WithRequestID(r.Context(), id)))
	})
}

// RequireSession guards protected endpoints: missing, unknown, or expired
// session → 401 UNAUTHORIZED envelope, no handler logic runs.
func (h *Handlers) RequireSession(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		id := ""
		if ck, err := r.Cookie(CookieName); err == nil {
			id = ck.Value
		}
		email, err := h.Auth.SessionUser(id)
		if err != nil {
			envelope.Fail(w, r, http.StatusUnauthorized, "UNAUTHORIZED",
				"Authentication is required.")
			return
		}
		next.ServeHTTP(w, r.WithContext(context.WithValue(r.Context(), ctxEmail, email)))
	})
}
