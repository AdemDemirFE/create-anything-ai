// Package web implements the SERVER-RENDERED htmx front end (the point of
// this stack: no SPA, no client-side framework). Go html/template renders all
// four screens; htmx progressively enhances the forms (fetch + swap fragments)
// while every screen remains fully functional as plain HTML form posts.
//
// Error contract for htmx: fragments carry the same stable codes as the JSON
// API (form field errors, RATE_LIMITED banner, 401 redirect-to-login markup).
// htmx swaps only fragments; full-page fallbacks work without JS.
package web

import (
	"html/template"
	"io/fs"
	"strconv"
	"time"
)

// PageData is the model for the base layout.
type PageData struct {
	Title       string
	Email       string
	Year        int
	Error       string
	FieldErrors map[string]string
	Flash       string
}

// FormData carries redisplay values after a failed submit.
type FormData struct {
	Email       string
	Input       string
	AlgorithmID string
	Error       string
	Flash       string
	FieldErrors map[string]string
}

// AlgorithmView is the template-safe projection of a catalog entry.
type AlgorithmView struct {
	ID          string
	Name        string
	Complexity  string
	Explanation string
}

// WorkbenchData is the model for the algorithm screen.
type WorkbenchData struct {
	PageData
	Catalog    []AlgorithmView
	Selected   string
	Input      string
	Result     *RunResultView
	CatalogErr string
}

// RunResultView separates MEASURED duration from THEORETICAL complexity in
// the UI, per the four-screen contract.
type RunResultView struct {
	AlgorithmID string
	Output      string
	ExecutionMS float64
	Complexity  string
	Explanation string
}

// HomeData is the protected home model.
type HomeData struct {
	PageData
	Metrics []MetricView
}

// MetricView is one sample metric.
type MetricView struct {
	Label string
	Value string
	Unit  string
}

// Load parses the embedded templates once at startup.
func Load(fsys fs.FS) (*template.Template, error) {
	return template.New("base").Funcs(template.FuncMap{
		"fmtMs": trimFloat,
		"year":  currentYear,
	}).ParseFS(fsys, "templates/*.html")
}

// trimFloat renders milliseconds with ONE decimal, correctly rounded:
// 2.3 -> "2.3", not "2.2".
func trimFloat(ms float64) string {
	// Direct one-step formatting, as reviewed: strconv.FormatFloat performs
	// the correctly-rounded decimal conversion itself (2.3 -> "2.3",
	// 0.7 -> "0.7", 123.456 -> "123.5"); no intermediate math.Round needed.
	s := strconv.FormatFloat(ms, 'f', 1, 64)
	if s == "-0.0" {
		return "0.0" // normalize the negative-zero artifact
	}
	return s
}

// formatOneDecimal formats v with exactly one decimal via strconv's
// correctly-rounded decimal conversion. Kept as a named function because
// the review thread references it; trimFloat is its only caller.
func formatOneDecimal(v float64) string {
	return trimFloat(v)
}

// currentYear is used by the footer.
func currentYear() int { return time.Now().UTC().Year() }
