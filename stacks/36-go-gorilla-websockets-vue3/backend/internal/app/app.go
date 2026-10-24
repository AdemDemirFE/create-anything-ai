// Package app wires the net/http server: JSON API (/api/v1/**), the /ws
// upgrade endpoint backed by the hand-rolled hub, and health. It is also the
// test entry point: tests call New and drive it through httptest.Server,
// exercising the exact production wiring (no separate test server).
package app

import (
	"context"
	"errors"
	"log"
	"net/http"
	"os"
	"strings"
	"time"

	"github.com/AdemDemirFE/create-anything-ai/stacks/36-go-gorilla-websockets-vue3/backend/internal/api"
	"github.com/AdemDemirFE/create-anything-ai/stacks/36-go-gorilla-websockets-vue3/backend/internal/auth"
	"github.com/AdemDemirFE/create-anything-ai/stacks/36-go-gorilla-websockets-vue3/backend/internal/clientip"
	"github.com/AdemDemirFE/create-anything-ai/stacks/36-go-gorilla-websockets-vue3/backend/internal/store"
	"github.com/AdemDemirFE/create-anything-ai/stacks/36-go-gorilla-websockets-vue3/backend/internal/throttle"
	"github.com/AdemDemirFE/create-anything-ai/stacks/36-go-gorilla-websockets-vue3/backend/internal/ws"
)

// App owns the composed dependencies and the http.Server.
type App struct {
	Hub    *ws.Hub
	Origin *ws.OriginChecker
	Auth   *auth.Service
	srv    *http.Server
}

// Options configures New (zero values = documented defaults).
type Options struct {
	// Addr to serve on (":8080" default).
	Addr string
	// AllowedOrigins for the WS handshake; empty → SameOriginDefault().
	AllowedOrigins []string
	// HubConfig nil → ws.DefaultConfig().
	HubConfig *ws.Config
	// SecureCookies sets the Secure flag on session cookies (behind TLS).
	SecureCookies bool
}

// New composes the full application and returns it with its HTTP handler.
// It does NOT listen; callers Run() or wrap Handler() in httptest.
func New(opts Options) *App {
	memStore := store.NewMemory(nil)
	limiter := throttle.New(throttle.Default(), nil)
	resolver := clientip.New(trustedProxiesFromEnv())
	authSvc := auth.New(memStore, limiter, resolver, nil)

	hub := ws.NewHub(opts.HubConfig)
	origins := opts.AllowedOrigins
	if len(origins) == 0 {
		origins = ws.SameOriginDefault()
	}
	origin := ws.NewOriginChecker(origins)
	upgrader := api.Upgrader(origin)

	handlers := &api.Handlers{Auth: authSvc, SecureCookies: opts.SecureCookies}
	broadcaster := &api.HubBroadcaster{Hub: hub}

	mux := http.NewServeMux()

	// Health (public, no envelope dependency).
	mux.HandleFunc("GET /healthz", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json; charset=utf-8")
		_, _ = w.Write([]byte(`{"status":"ok"}`))
	})

	// JSON API under /api/v1: public auth endpoints + protected group.
	v1 := http.NewServeMux()
	v1.HandleFunc("POST /register", handlers.Register)
	v1.HandleFunc("POST /login", handlers.Login)
	v1.HandleFunc("POST /logout", handlers.Logout)

	protected := http.NewServeMux()
	protected.HandleFunc("GET /me", handlers.Me)
	protected.HandleFunc("GET /home", handlers.Home)
	protected.HandleFunc("GET /algorithm", handlers.AlgorithmCatalog)
	protected.HandleFunc("POST /algorithm/run", handlers.AlgorithmRun)

	// Protected endpoints run behind RequireSession with the hub publisher
	// injected into the request context.
	protectedChain := Chain(
		protected,
		handlers.RequireSession,
		func(next http.Handler) http.Handler {
			return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				next.ServeHTTP(w, r.WithContext(api.WithPublisher(r.Context(), broadcaster)))
			})
		},
	)
	mux.Handle("/api/v1/", http.StripPrefix("/api/v1", protectedChain))
	mux.Handle("/api/v1/register", http.StripPrefix("/api/v1", v1))
	mux.Handle("/api/v1/login", http.StripPrefix("/api/v1", v1))
	mux.Handle("/api/v1/logout", http.StripPrefix("/api/v1", v1))

	// /ws: request-id → session → upgrade → hand-rolled hub.
	wsChain := Chain(
		http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			handlers.ServeWS(w, r, &upgrader, hub)
		}),
		handlers.RequireSession,
	)
	mux.Handle("/ws", wsChain)

	// Every response carries X-Request-Id (and meta.request_id matches).
	handler := Chain(mux, handlers.WithRequestID)

	go hub.Run()

	addr := opts.Addr
	if addr == "" {
		addr = ":8080"
	}
	return &App{
		Hub:    hub,
		Origin: origin,
		Auth:   authSvc,
		srv: &http.Server{
			Addr:              addr,
			Handler:           handler,
			ReadHeaderTimeout: 10 * time.Second,
			ReadTimeout:       15 * time.Second,
			WriteTimeout:      0, // WS connections outlive request write budgets
			IdleTimeout:       60 * time.Second,
			ErrorLog:          log.New(os.Stderr, "stack36-backend: ", log.LstdFlags),
		},
	}
}

// Handler exposes the composed root handler (tests use this).
func (a *App) Handler() http.Handler { return a.srv.Handler }

// Run starts the HTTP server (the hub loop already runs); blocks until Shutdown.
func (a *App) Run() error {
	err := a.srv.ListenAndServe()
	if errors.Is(err, http.ErrServerClosed) {
		return nil
	}
	return err
}

// Shutdown gracefully stops the server and the hub.
func (a *App) Shutdown(ctx context.Context) error {
	err := a.srv.Shutdown(ctx)
	a.Hub.Stop()
	return err
}

// Chain applies middleware outermost-first.
func Chain(h http.Handler, mw ...func(http.Handler) http.Handler) http.Handler {
	for i := len(mw) - 1; i >= 0; i-- {
		h = mw[i](h)
	}
	return h
}

// trustedProxiesFromEnv reads TRUSTED_PROXIES (comma-separated). Default is
// empty: XFF is ignored and the TCP peer is the client identity.
func trustedProxiesFromEnv() []string {
	raw := strings.TrimSpace(os.Getenv("TRUSTED_PROXIES"))
	if raw == "" {
		return nil
	}
	parts := strings.Split(raw, ",")
	out := make([]string, 0, len(parts))
	for _, p := range parts {
		if p = strings.TrimSpace(p); p != "" {
			out = append(out, p)
		}
	}
	return out
}
