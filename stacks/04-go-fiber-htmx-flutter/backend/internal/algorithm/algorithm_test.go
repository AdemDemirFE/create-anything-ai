package algorithm

import (
	"errors"
	"testing"
	"time"
)

// TestCatalogIsFixedAndSafe asserts the workbench can only run the reviewed
// fixed algorithms. There is no code-input path: ids outside the catalog are
// rejected, and the dispatch is a compile-time switch (see compute).
func TestCatalogIsFixedAndSafe(t *testing.T) {
	want := map[string]string{
		"fizzbuzz":   "O(n)",
		"palindrome": "O(n)",
		"fibonacci":  "O(n)",
		"reverse":    "O(n)",
	}
	if len(Catalog) != len(want) {
		t.Fatalf("catalog size changed: got %d, want %d", len(Catalog), len(want))
	}
	for _, e := range Catalog {
		if want[e.ID] != e.Complexity {
			t.Errorf("entry %s: complexity %q, want %q", e.ID, e.Complexity, want[e.ID])
		}
		if e.Explanation == "" {
			t.Errorf("entry %s: missing complexity explanation", e.ID)
		}
	}
}

func TestRunFizzBuzz(t *testing.T) {
	r, err := Run("fizzbuzz", "15", nil)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	want := "1\n2\nFizz\n4\nBuzz\nFizz\n7\n8\nFizz\nBuzz\n11\nFizz\n13\n14\nFizzBuzz"
	if r.Output != want {
		t.Errorf("fizzbuzz(15) output mismatch:\n%s", r.Output)
	}
	if r.Complexity != "O(n)" {
		t.Errorf("complexity = %q, want O(n)", r.Complexity)
	}
}

func TestRunPalindrome(t *testing.T) {
	cases := []struct {
		in   string
		want string
	}{
		{"Racecar!", "Input is a palindrome."},
		{"hello", "Input is not a palindrome."},
		{"A man, a plan, a canal: Panama", "Input is a palindrome."},
	}
	for _, c := range cases {
		r, err := Run("palindrome", c.in, nil)
		if err != nil {
			t.Fatalf("palindrome(%q): %v", c.in, err)
		}
		if r.Output != c.want {
			t.Errorf("palindrome(%q) = %q, want %q", c.in, r.Output, c.want)
		}
	}
}

func TestRunFibonacciBounded(t *testing.T) {
	r, err := Run("fibonacci", "10", nil)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	want := "0, 1, 1, 2, 3, 5, 8, 13, 21, 34"
	if r.Output != want {
		t.Errorf("fibonacci(10) = %q, want %q", r.Output, want)
	}
	// Out-of-range n must be rejected (bounded context).
	if _, err := Run("fibonacci", "91", nil); !errors.Is(err, ErrInvalidInput) {
		t.Errorf("fibonacci(91) error = %v, want ErrInvalidInput", err)
	}
	if _, err := Run("fibonacci", "-1", nil); !errors.Is(err, ErrInvalidInput) {
		t.Errorf("fibonacci(-1) error = %v, want ErrInvalidInput", err)
	}
	if _, err := Run("fibonacci", "abc", nil); !errors.Is(err, ErrInvalidInput) {
		t.Errorf("fibonacci(abc) error = %v, want ErrInvalidInput", err)
	}
}

func TestRunReverse(t *testing.T) {
	r, err := Run("reverse", "abc", nil)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if r.Output != "cba" {
		t.Errorf("reverse(abc) = %q, want cba", r.Output)
	}
}

func TestRunRejectsUnknownAlgorithm(t *testing.T) {
	if _, err := Run("eval-user-code", "anything", nil); !errors.Is(err, ErrUnknownAlgorithm) {
		t.Errorf("unknown id error = %v, want ErrUnknownAlgorithm", err)
	}
}

func TestRunRejectsOversizedInput(t *testing.T) {
	big := make([]byte, MaxInputLength+1)
	for i := range big {
		big[i] = 'a'
	}
	if _, err := Run("reverse", string(big), nil); !errors.Is(err, ErrInputTooLarge) {
		t.Errorf("oversized error = %v, want ErrInputTooLarge", err)
	}
	// Exactly at the limit is accepted.
	ok := make([]byte, MaxInputLength)
	for i := range ok {
		ok[i] = 'a'
	}
	if _, err := Run("reverse", string(ok), nil); err != nil {
		t.Errorf("input at limit should pass, got %v", err)
	}
}

// TestMeasuredDurationVsComplexity asserts the two concepts stay separate
// fields: ExecutionMS is the measured wall time (monotonic clock), Complexity
// is the static theoretical label. A tiny input must not "prove" anything
// about Big-O.
func TestMeasuredDurationVsComplexity(t *testing.T) {
	r, err := Run("fizzbuzz", "5", nil)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if r.ExecutionMS < 0 {
		t.Errorf("measured duration must be >= 0, got %v", r.ExecutionMS)
	}
	if r.Complexity != "O(n)" || r.Explanation == "" {
		t.Errorf("complexity/explanation missing or wrong: %q / %q", r.Complexity, r.Explanation)
	}
}

// TestRunWithInjectedClock pins the measurement path to a deterministic clock
// so tests never depend on real scheduling jitter.
func TestRunWithInjectedClock(t *testing.T) {
	fake := time.Unix(0, 0)
	r, err := Run("reverse", "xyz", func() time.Time { return fake })
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if r.ExecutionMS != 0 {
		t.Errorf("injected clock should measure zero elapsed, got %v", r.ExecutionMS)
	}
	if r.Output != "zyx" {
		t.Errorf("output = %q, want zyx", r.Output)
	}
}
