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
	Catalog   []AlgorithmView
	Selected  string
	Input     string
	Result    *RunResultView
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

func trimFloat(ms float64) string {
	v := float64(int(ms*10+0.5)) / 10
	s := formatOneDecimal(v)
	return s
}

func formatOneDecimal(v float64) string {
	intPart := int(v)
	dec := int((v - float64(intPart)) * 10)
	if dec < 0 {
		dec = -dec
	}
	return itoa(intPart) + "." + itoa(dec)
}

func itoa(n int) string {
	if n == 0 {
		return "0"
	}
	neg := n < 0
	if neg {
		n = -n
	}
	var buf [20]byte
	i := len(buf)
	for n > 0 {
		i--
		buf[i] = byte('0' + n%10)
		n /= 10
	}
	if neg {
		i--
		buf[i] = '-'
	}
	return string(buf[i:])
}

// currentYear is used by the footer.
func currentYear() int { return time.Now().UTC().Year() }
