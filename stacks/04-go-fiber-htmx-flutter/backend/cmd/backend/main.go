// Command backend is the Stack 04 API + server-rendered web server.
//
// Environment:
//
//	PORT             listen port (default 8080)
//	COOKIE_SECURE    "true" behind TLS: adds the Secure flag to the session cookie
//	TRUSTED_PROXIES  comma-separated trusted proxy IPs/prefixes; default empty
//	                 (X-Forwarded-For is then ignored entirely)
//
// Data is in-memory (see internal/store for the documented decision): a
// restart clears accounts and sessions.
package main

import (
	"log"
	"os"
	"strconv"

	"github.com/AdemDemirFE/create-anything-ai/stacks/04-go-fiber-htmx-flutter/backend/internal/app"
)

func main() {
	port := 8080
	if raw := os.Getenv("PORT"); raw != "" {
		if p, err := strconv.Atoi(raw); err == nil && p > 0 && p < 65536 {
			port = p
		}
	}
	a := app.New()
	log.Printf("stack04 backend listening on :%d (in-memory store)", port)
	if err := a.Listen(":" + strconv.Itoa(port)); err != nil {
		log.Fatal(err)
	}
}
