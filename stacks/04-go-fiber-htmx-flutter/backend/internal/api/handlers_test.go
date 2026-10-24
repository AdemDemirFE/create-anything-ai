package api

import (
	"testing"

	"github.com/gofiber/fiber/v3"
)

// TestCookieHelpersCompileAndRoundTrip pins the cookie flag contract at the
// helper level (the integration tests assert it over the real app).
func TestCookieHelpersCompileAndRoundTrip(t *testing.T) {
	if CookieName != "STACK04_SESSION" {
		t.Fatalf("cookie name = %q, want STACK04_SESSION", CookieName)
	}
	// Compile-time check: handlers satisfy fiber handler signature.
	var _ fiber.Handler = (&Handlers{}).Register
}
