// Package app wires the Fiber application: JSON API (/api/v1/**), the
// server-rendered htmx web front end, and the embedded static assets.
package app

import (
	"embed"
	"io/fs"
	"os"
	"strconv"
	"strings"

	"github.com/gofiber/fiber/v3"
	"github.com/gofiber/fiber/v3/middleware/compress"
	"github.com/gofiber/fiber/v3/middleware/recover"

	"github.com/AdemDemirFE/create-anything-ai/stacks/04-go-fiber-htmx-flutter/backend/internal/api"
	"github.com/AdemDemirFE/create-anything-ai/stacks/04-go-fiber-htmx-flutter/backend/internal/auth"
	"github.com/AdemDemirFE/create-anything-ai/stacks/04-go-fiber-htmx-flutter/backend/internal/clientip"
	"github.com/AdemDemirFE/create-anything-ai/stacks/04-go-fiber-htmx-flutter/backend/internal/envelope"
	"github.com/AdemDemirFE/create-anything-ai/stacks/04-go-fiber-htmx-flutter/backend/internal/store"
	"github.com/AdemDemirFE/create-anything-ai/stacks/04-go-fiber-htmx-flutter/backend/internal/throttle"
	"github.com/AdemDemirFE/create-anything-ai/stacks/04-go-fiber-htmx-flutter/backend/internal/web"
)

//go:embed static
var staticFiles embed.FS

//go:embed templates
var templateFiles embed.FS

// New builds the full application. It is also the test entry point: tests
// call New and drive it through httptest, exercising the exact production
// wiring (no separate test server implementation).
func New() *fiber.App {
	memStore := store.NewMemory(nil)
	limiter := throttle.New(throttle.Default(), nil)
	resolver := clientip.New(trustedProxiesFromEnv())
	authSvc := auth.New(memStore, limiter, resolver, nil)
	secure := cookieSecureFromEnv()
	apiHandlers := &api.Handlers{Auth: authSvc, SecureCookies: func() bool { return secure }}

	webFS, err := fs.Sub(staticFiles, "static")
	if err != nil {
		panic(err)
	}
	tmpl, err := web.Load(templateFiles)
	if err != nil {
		panic(err)
	}
	webRoutes := &web.Routes{
		Auth:          authSvc,
		Tmpl:          web.NewTemplates(tmpl),
		SecureCookies: secure,
	}

	app := fiber.New(fiber.Config{
		AppName:      "stack04-backend",
		ReadTimeout:  10_000_000_000,  // 10s
		WriteTimeout: 10_000_000_000,  // 10s
		BodyLimit:    256 * 1024,      // bounded request bodies (256KB)
		JSONEncoder:  nil,             // default encoding/json
		ErrorHandler: errorHandler,
	})

	app.Use(recover.New())
	app.Use(compress.New(compress.Config{Level: compress.LevelDefault}))

	// Static assets (htmx.min.js) served from the embedded FS.
	app.Get("/static/*", func(c fiber.Ctx) error {
		path := c.Params("*")
		data, err := fs.ReadFile(webFS, path)
		if err != nil {
			return fiber.NewError(fiber.StatusNotFound, "not found")
		}
		c.Set("Content-Type", contentTypeFor(path))
		c.Set("Cache-Control", "public, max-age=3600")
		return c.Send(data)
	})

	// Health (public, no envelope dependency).
	app.Get("/healthz", func(c fiber.Ctx) error {
		return c.JSON(fiber.Map{"status": "ok"})
	})

	registerAPI(app, apiHandlers)
	registerWeb(app, webRoutes)

	return app
}

// registerAPI mounts the JSON API under /api/v1.
func registerAPI(app *fiber.App, h *api.Handlers) {
	v1 := app.Group("/api/v1")
	v1.Post("/register", h.Register)
	v1.Post("/login", h.Login)
	v1.Post("/logout", h.Logout)

	protected := v1.Group("/", h.RequireSession)
	protected.Get("/me", func(c fiber.Ctx) error {
		return envelope.OK(c, fiber.Map{"email": api.SessionEmail(c)})
	})
	protected.Get("/home", h.Home)
	protected.Get("/algorithm", h.AlgorithmCatalog)
	protected.Post("/algorithm/run", h.AlgorithmRun)
}

// registerWeb mounts the server-rendered htmx screens.
func registerWeb(app *fiber.App, r *web.Routes) {
	app.Get("/", func(c fiber.Ctx) error {
		if r.CurrentUserPublic(c) {
			return c.Redirect().To("/home")
		}
		return c.Redirect().To("/login")
	})
	app.Get("/register", r.RegisterPage)
	app.Post("/register", r.Register)
	app.Get("/login", r.LoginPage)
	app.Post("/login", r.Login)
	app.Post("/logout", r.Logout)
	app.Get("/home", r.RequireSessionForPage, r.Home)
	app.Get("/algorithm", r.RequireSessionForPage, r.AlgorithmPage)
	app.Post("/algorithm/run", r.RequireSessionForPage, r.AlgorithmRun)
}

// errorHandler returns envelope errors for API paths and plain text
// otherwise; stack traces never reach the client.
func errorHandler(c fiber.Ctx, err error) error {
	code := fiber.StatusInternalServerError
	var fe *fiber.Error
	if errorsAs(err, &fe) {
		code = fe.Code
	}
	if strings.HasPrefix(c.Path(), "/api/") {
		return EnvelopeError(c, code)
	}
	return c.Status(code).SendString(httpStatusText(code))
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

// cookieSecureFromEnv reads COOKIE_SECURE (default false; set true behind
// TLS so the session cookie gains the Secure flag).
func cookieSecureFromEnv() bool {
	raw := strings.TrimSpace(strings.ToLower(os.Getenv("COOKIE_SECURE")))
	if raw == "" {
		return false
	}
	v, err := strconv.ParseBool(raw)
	if err != nil {
		return false
	}
	return v
}

func contentTypeFor(path string) string {
	switch {
	case strings.HasSuffix(path, ".js"):
		return "application/javascript; charset=utf-8"
	case strings.HasSuffix(path, ".css"):
		return "text/css; charset=utf-8"
	default:
		return "application/octet-stream"
	}
}

func httpStatusText(code int) string {
	if t := statusText(code); t != "" {
		return t
	}
	return "Error"
}

// statusText maps a handful of statuses; avoids depending on fasthttp's
// internal message table.
func statusText(code int) string {
	switch code {
	case 400:
		return "Bad Request"
	case 401:
		return "Unauthorized"
	case 403:
		return "Forbidden"
	case 404:
		return "Not Found"
	case 405:
		return "Method Not Allowed"
	case 409:
		return "Conflict"
	case 413:
		return "Request Entity Too Large"
	case 422:
		return "Unprocessable Entity"
	case 429:
		return "Too Many Requests"
	case 500:
		return "Internal Server Error"
	default:
		return ""
	}
}
