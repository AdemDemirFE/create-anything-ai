// Command backend is the Stack 36 entry point: net/http + gorilla/websocket
// with a hand-rolled hub (çırak-WS paradigm). Configuration is environment
// only (no config file in the reference scope):
//
//	PORT             listen address (default :8080)
//	COOKIE_SECURE    set true behind TLS → session cookie gains Secure
//	TRUSTED_PROXIES  comma-separated trusted proxy IPs/prefixes (default: none)
//	WS_ORIGINS       comma-separated allowed WS origins (default: Vite dev server)
package main

import (
	"context"
	"os"
	"os/signal"
	"strings"
	"syscall"
	"time"

	"github.com/AdemDemirFE/create-anything-ai/stacks/36-go-gorilla-websockets-vue3/backend/internal/app"
	"github.com/AdemDemirFE/create-anything-ai/stacks/36-go-gorilla-websockets-vue3/backend/internal/ws"
)

func main() {
	addr := ":" + envOr("PORT", "8080")

	var hubCfg *ws.Config
	if raw := os.Getenv("WS_PING_PERIOD"); raw != "" {
		if d, err := time.ParseDuration(raw); err == nil {
			cfg := ws.DefaultConfig()
			cfg.PingPeriod = d
			cfg.PongWait = d * 3 / 2
			hubCfg = &cfg
		}
	}

	opts := app.Options{
		Addr:           addr,
		HubConfig:      hubCfg,
		SecureCookies:  envBool("COOKIE_SECURE"),
		AllowedOrigins: splitCSV(os.Getenv("WS_ORIGINS")),
	}

	a := app.New(opts)

	go func() {
		if err := a.Run(); err != nil {
			panic(err)
		}
	}()

	stop := make(chan os.Signal, 1)
	signal.Notify(stop, os.Interrupt, syscall.SIGTERM)
	<-stop

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	_ = a.Shutdown(ctx)
}

func envOr(key, def string) string {
	if v := strings.TrimSpace(os.Getenv(key)); v != "" {
		return v
	}
	return def
}

func envBool(key string) bool {
	switch strings.ToLower(strings.TrimSpace(os.Getenv(key))) {
	case "1", "true", "yes", "on":
		return true
	}
	return false
}

func splitCSV(raw string) []string {
	raw = strings.TrimSpace(raw)
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
