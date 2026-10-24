package auth

import (
	"testing"
	"time"

	"github.com/AdemDemirFE/create-anything-ai/stacks/04-go-fiber-htmx-flutter/backend/internal/store"
)

// Test helpers: the production service is wired through app.New; these
// construct the in-memory store directly for unit tests.
func newStoreMemory() store.Store {
	return store.NewMemory(nil)
}

func newStoreMemoryWithClock(now func() time.Time) store.Store {
	return store.NewMemory(now)
}

var _ = store.HashPassword
var _ = testing.Short
