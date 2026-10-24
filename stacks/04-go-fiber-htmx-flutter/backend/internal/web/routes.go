// Package web — handler wiring. Routes:
//
//	GET  /            -> redirect to /home or /login
//	GET  /register    -> register screen
//	POST /register    -> create account (full page or htmx fragment)
//	GET  /login       -> login screen
//	POST /login       -> login (full page or htmx fragment)
//	POST /logout      -> invalidate session server-side
//	GET  /home        -> protected (401 -> redirect to /login with flash)
//	GET  /algorithm   -> protected workbench
//	POST /algorithm/run -> protected run (fragment target)
//
// Every screen is server-rendered html/template output; htmx only swaps
// fragments. Without JavaScript the same forms post and render full pages —
// progressive enhancement, not an SPA.
package web

import (
	"errors"

	"github.com/gofiber/fiber/v3"

	"github.com/AdemDemirFE/create-anything-ai/stacks/04-go-fiber-htmx-flutter/backend/internal/algorithm"
	"github.com/AdemDemirFE/create-anything-ai/stacks/04-go-fiber-htmx-flutter/backend/internal/api"
	"github.com/AdemDemirFE/create-anything-ai/stacks/04-go-fiber-htmx-flutter/backend/internal/auth"
)

// Routes carries web dependencies.
type Routes struct {
	Auth  *auth.Service
	Tmpl  *Templates
	SecureCookies bool
}

// Templates wraps the parsed template render functions used by the handlers.
type Templates struct {
	Home      renderFunc // full home page
	Login     renderFunc // full login page
	Register  renderFunc // full register page
	Algorithm renderFunc // full workbench page
	Form      renderFunc // htmx form fragment (login-form)
	RunResult renderFunc // htmx run-result fragment
}

type renderFunc func(data any) (string, error)

// isHTMX reports whether the request came from htmx (fragment swap wanted).
func isHTMX(c fiber.Ctx) bool {
	return c.Get("HX-Request") == "true"
}

// currentUser resolves the session cookie to an email ("" when anonymous).
func (r *Routes) currentUser(c fiber.Ctx) string {
	email, err := r.Auth.SessionUser(c.Cookies(api.CookieName))
	if err != nil {
		return ""
	}
	return email
}

// CurrentUserPublic reports whether the request carries a valid session. It
// is used by the root redirect.
func (r *Routes) CurrentUserPublic(c fiber.Ctx) bool {
	return r.currentUser(c) != ""
}

// RequireSessionForPage is the exported guard used by the app wiring.
func (r *Routes) RequireSessionForPage(c fiber.Ctx) error {
	return r.requireSessionForPage(c)
}

// requireSessionForPage guards the protected pages. Unauthenticated page
// requests are redirected to /login (302); htmx fragment requests get the
// HX-Redirect header. This is the 401/403 surface for the UI.
func (r *Routes) requireSessionForPage(c fiber.Ctx) error {
	email := r.currentUser(c)
	if email == "" {
		if isHTMX(c) {
			c.Set("HX-Redirect", "/login")
			return c.SendStatus(fiber.StatusUnauthorized)
		}
		return c.Redirect().To("/login?flash=login-required")
	}
	c.Locals("email", email)
	return c.Next()
}

// Home renders the protected home screen.
func (r *Routes) Home(c fiber.Ctx) error {
	data := HomeData{
		PageData: PageData{Title: "Home", Email: r.currentUser(c), Year: currentYear()},
		Metrics: []MetricView{
			{Label: "Active sessions", Value: "1", Unit: "session"},
			{Label: "Algorithms available", Value: "4", Unit: "items"},
			{Label: "Uptime", Value: "demo", Unit: "reference"},
		},
	}
	return renderPage(c, r.Tmpl.Home, data, fiber.StatusOK)
}

// RegisterPage renders the register screen.
func (r *Routes) RegisterPage(c fiber.Ctx) error {
	if r.currentUser(c) != "" {
		return c.Redirect().To("/home")
	}
	data := FormData{Email: c.FormValue("email")}
	return renderPage(c, r.Tmpl.Register, data, fiber.StatusOK)
}

// LoginPage renders the login screen (with optional flash from redirects).
func (r *Routes) LoginPage(c fiber.Ctx) error {
	if r.currentUser(c) != "" {
		return c.Redirect().To("/home")
	}
	data := FormData{}
	switch c.Query("flash") {
	case "login-required":
		data.Flash = "Please log in to open that screen."
	case "registered":
		data.Flash = "Account created. Log in to continue."
	}
	return renderPage(c, r.Tmpl.Login, data, fiber.StatusOK)
}

// Register handles the register form post for both full-page and htmx modes.
func (r *Routes) Register(c fiber.Ctx) error {
	email := c.FormValue("email")
	password := c.FormValue("password")

	_, err := r.Auth.Register(email, password)
	if err != nil {
		return r.renderAuthError(c, err, "register")
	}

	if isHTMX(c) {
		// Full page reload so the session nav and flash render.
		c.Set("HX-Redirect", "/login?flash=registered")
		return c.SendStatus(fiber.StatusNoContent)
	}
	return c.Redirect().To("/login?flash=registered")
}

// Login handles the login form post for both modes. On success the session
// cookie is set; failures re-render the form with a visible error.
func (r *Routes) Login(c fiber.Ctx) error {
	email := c.FormValue("email")
	password := c.FormValue("password")

	sess, err := r.Auth.Login(email, password, c.IP(), c.Get("X-Forwarded-For"))
	if err != nil {
		return r.renderAuthError(c, err, "login")
	}

	setWebSessionCookie(c, sess.ID, sess.ExpiresAt, r.SecureCookies)
	if isHTMX(c) {
		c.Set("HX-Redirect", "/home")
		return c.SendStatus(fiber.StatusNoContent)
	}
	return c.Redirect().To("/home")
}

// Logout invalidates the session server-side and clears the cookie.
func (r *Routes) Logout(c fiber.Ctx) error {
	if id := c.Cookies(api.CookieName); id != "" {
		r.Auth.Logout(id)
	}
	clearWebSessionCookie(c, r.SecureCookies)
	return c.Redirect().To("/login")
}

// AlgorithmPage renders the protected workbench with the fixed catalog.
func (r *Routes) AlgorithmPage(c fiber.Ctx) error {
	data := WorkbenchData{
		PageData: PageData{Title: "Algorithm workbench", Email: r.currentUser(c), Year: currentYear()},
		Catalog:  catalogViews(),
		Selected: algorithm.Catalog[0].ID,
	}
	return renderPage(c, r.Tmpl.Algorithm, data, fiber.StatusOK)
}

// AlgorithmRun executes the chosen fixed algorithm. htmx requests swap the
// #run-result fragment; plain posts re-render the whole page with the result.
func (r *Routes) AlgorithmRun(c fiber.Ctx) error {
	algorithmID := c.FormValue("algorithm_id")
	input := c.FormValue("input")

	result, err := algorithm.Run(algorithmID, input, nil)
	if err != nil {
		return r.renderRunError(c, algorithmID, input, err)
	}

	data := WorkbenchData{
		PageData: PageData{Title: "Algorithm workbench", Email: r.currentUser(c), Year: currentYear()},
		Catalog:  catalogViews(),
		Selected: algorithmID,
		Input:    input,
		Result: &RunResultView{
			AlgorithmID: result.AlgorithmID,
			Output:      result.Output,
			ExecutionMS: result.ExecutionMS,
			Complexity:  result.Complexity,
			Explanation: result.Explanation,
		},
	}
	if isHTMX(c) {
		return renderPage(c, r.Tmpl.RunResult, data, fiber.StatusOK)
	}
	return renderPage(c, r.Tmpl.Algorithm, data, fiber.StatusOK)
}

// renderAuthError maps auth errors to form redisplay (visible errors).
func (r *Routes) renderAuthError(c fiber.Ctx, err error, form string) error {
	data := FormData{Email: c.FormValue("email")}
	var ve *auth.ValidationError
	switch {
	case errors.As(err, &ve):
		data.FieldErrors = map[string]string{}
		for _, f := range ve.Fields {
			switch f.Field {
			case "email":
				data.FieldErrors["email"] = "Enter a valid email address."
			case "password":
				data.FieldErrors["password"] = "Use at least 10 characters including letters and digits."
			}
		}
		data.Error = "Please fix the highlighted fields."
	case errors.Is(err, auth.ErrEmailTaken):
		data.Error = "An account with this email already exists."
	case errors.Is(err, auth.ErrRateLimited):
		data.Error = "Too many failed attempts. Please wait a minute and try again."
		if isHTMX(c) {
			c.Set("Retry-After", itoa(r.Auth.RetryAfterSeconds()))
		}
	case errors.Is(err, auth.ErrInvalidCreds):
		data.Error = "Invalid email or password."
	default:
		data.Error = "An unexpected error occurred. Please try again."
	}

	if isHTMX(c) {
		return renderPage(c, r.Tmpl.Form, data, fiber.StatusUnprocessableEntity)
	}
	return r.renderFormFullPage(c, form, data, fiber.StatusUnprocessableEntity)
}

// renderRunError maps algorithm errors to the workbench screens.
func (r *Routes) renderRunError(c fiber.Ctx, algorithmID, input string, err error) error {
	data := WorkbenchData{
		PageData: PageData{Title: "Algorithm workbench", Email: r.currentUser(c), Year: currentYear()},
		Catalog:  catalogViews(),
		Selected: algorithmID,
		Input:    input,
	}
	switch {
	case errors.Is(err, algorithm.ErrUnknownAlgorithm):
		data.Error = "Unknown algorithm."
	case errors.Is(err, algorithm.ErrInputTooLarge):
		data.Error = "Input exceeds the maximum of 10,000 characters."
	case errors.Is(err, algorithm.ErrInvalidInput):
		data.Error = "The input is invalid for this algorithm."
	default:
		data.Error = "An unexpected error occurred. Please try again."
	}

	if isHTMX(c) {
		return renderPage(c, r.Tmpl.RunResult, data, fiber.StatusOK)
	}
	return renderPage(c, r.Tmpl.Algorithm, data, fiber.StatusOK)
}

func formTitle(form string) string {
	if form == "register" {
		return "Register"
	}
	return "Log in"
}

func catalogViews() []AlgorithmView {
	views := make([]AlgorithmView, 0, len(algorithm.Catalog))
	for _, e := range algorithm.Catalog {
		views = append(views, AlgorithmView{
			ID: e.ID, Name: e.Name, Complexity: e.Complexity, Explanation: e.Explanation,
		})
	}
	return views
}

// renderFormFullPage re-renders the full register/login page with errors.
func (r *Routes) renderFormFullPage(c fiber.Ctx, form string, data FormData, status int) error {
	if form == "register" {
		return renderPage(c, r.Tmpl.Register, data, status)
	}
	return renderPage(c, r.Tmpl.Login, data, status)
}

func renderPage(c fiber.Ctx, render renderFunc, data any, status int) error {
	out, err := render(data)
	if err != nil {
		return fiber.NewError(fiber.StatusInternalServerError, "template render failed")
	}
	c.Set("Content-Type", "text/html; charset=utf-8")
	return c.Status(status).SendString(out)
}
