// Package web tests: trimFloat is the ONE place where float formatting meets
// the user-visible UI, so it gets a table-driven unit test over the
// documented rounding edge cases (strconv.FormatFloat with one decimal).
// The old hand-rolled truncating formatter produced 2.3 -> "2.2".
package web

import (
	"os"
	"testing"
)

// TestTrimFloatRounding pins the rounding contract at the boundary values
// called out in review, plus float-artifact cases that break naive
// implementations (e.g. int(2.3*10) == 22 because 2.3*10 == 22.999...).
func TestTrimFloatRounding(t *testing.T) {
	tests := []struct {
		name  string
		input float64
		want  string
	}{
		// Reviewer-called-out boundary values.
		{"2.05 rounds to 2.0", 2.05, "2.0"},
		{"2.25 rounds to 2.2", 2.25, "2.2"},
		{"2.99 rounds to 3.0", 2.99, "3.0"},
		{"0.1 stays 0.1", 0.1, "0.1"},
		{"123.456 rounds to 123.5", 123.456, "123.5"},
		// Values the old truncating formatter got wrong.
		{"2.3 stays 2.3", 2.3, "2.3"},
		{"0.7 stays 0.7", 0.7, "0.7"},
		{"1.96 rounds to 2.0", 1.96, "2.0"},
		{"999.999 rounds to 1000.0", 999.999, "1000.0"},
		{"2.15 rounds to 2.1", 2.15, "2.1"},
		{"2.35 rounds to 2.4", 2.35, "2.4"},
		// Zero and negatives.
		{"0.04 rounds to 0.0", 0.04, "0.0"},
		{"zero stays 0.0", 0, "0.0"},
		{"tiny negative -0.04 normalizes to 0.0", -0.04, "0.0"},
		{"-2.3 stays -2.3", -2.3, "-2.3"},
		{"-1.25 rounds to -1.2", -1.25, "-1.2"},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			if got := trimFloat(tc.input); got != tc.want {
				t.Errorf("trimFloat(%g) = %q, want %q", tc.input, got, tc.want)
			}
		})
	}
}

// TestLoadParsesTemplates guards the template entry point: Load must parse
// the embedded template set without error (it feeds NewTemplates). The
// embedded FS is rooted at the package dir, so a plain DirFS(".") matches
// its layout (templates/ at the root).
func TestLoadParsesTemplates(t *testing.T) {
	if _, err := Load(os.DirFS(".")); err != nil {
		t.Fatalf("Load returned error: %v", err)
	}
}
