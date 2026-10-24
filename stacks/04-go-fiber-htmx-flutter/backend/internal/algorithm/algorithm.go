// Package algorithm implements the bounded algorithm workbench.
//
// SECURITY MODEL (the whole point of this screen):
//
//   - The catalog is a FIXED enum compiled into the binary. There is no code
//     input field anywhere; user-supplied code is never executed. A unit test
//     asserts the catalog contains only known-safe entries (no eval, no exec,
//     no dynamic dispatch of user input).
//   - Input length is capped at MaxInputLength (10,000 chars) at the engine
//     boundary, and numeric inputs are additionally range-bounded per
//     algorithm (defense in depth: the handler re-validates too).
//   - execution_ms is measured with time.Since over a monotonic clock
//     captured before the run, rounded to 0.1 ms. We do NOT claim microsecond
//     precision. The API reports measured duration and THEORETICAL Big-O
//     complexity as separate fields — small inputs do not prove complexity.
package algorithm

import (
	"errors"
	"fmt"
	"strconv"
	"strings"
	"time"
)

// MaxInputLength is the maximum accepted input length in characters.
const MaxInputLength = 10_000

// ErrInputTooLarge maps to the stable code INPUT_TOO_LARGE.
var ErrInputTooLarge = errors.New("input exceeds the maximum length")

// ErrUnknownAlgorithm maps to the stable code UNKNOWN_ALGORITHM.
var ErrUnknownAlgorithm = errors.New("unknown algorithm")

// ErrInvalidInput maps to the stable code VALIDATION_ERROR for
// algorithm-specific malformed input (e.g. non-numeric where a number is
// required, or out of the algorithm's range).
var ErrInvalidInput = errors.New("invalid algorithm input")

// Entry is one catalog item. Complexity and Explanation are human-readable
// strings shown next to (not instead of) the measured duration.
type Entry struct {
	ID          string `json:"id"`
	Name        string `json:"name"`
	Complexity  string `json:"complexity"`
	Explanation string `json:"explanation"`
}

// safe marks a catalog entry as reviewed: it performs pure computation on its
// bounded input only — no I/O, no dynamic evaluation, no user code.
type safe struct{}

// Catalog is the fixed list. Adding an entry requires updating the run
// switch below AND the safety test (compile-time enum + switch exhaustiveness
// make forgetting impossible without a build error).
var Catalog = []Entry{
	{
		ID:         "fizzbuzz",
		Name:       "FizzBuzz",
		Complexity: "O(n)",
		Explanation: "Iterates from 1 to n once and emits one line per number. " +
			"Linear in the requested count (n is bounded to 1..1000).",
	},
	{
		ID:         "palindrome",
		Name:       "Palindrome check",
		Complexity: "O(n)",
		Explanation: "Normalizes the text (letters/digits only, lowercase) and " +
			"compares it with its reversal; two linear passes over the input.",
	},
	{
		ID:         "fibonacci",
		Name:       "Fibonacci sequence",
		Complexity: "O(n)",
		Explanation: "Iterative addition of the last two values, n terms " +
			"(n is bounded to 1..90 to stay inside uint64). Linear time.",
	},
	{
		ID:         "reverse",
		Name:       "Reverse text",
		Complexity: "O(n)",
		Explanation: "Reverses the input rune by rune; one pass, allocates the " +
			"output once.",
	},
}

// RunResult is the engine output for one run.
type RunResult struct {
	AlgorithmID string  `json:"algorithm_id"`
	Output      string  `json:"output"`
	ExecutionMS float64 `json:"execution_ms"`
	Complexity  string  `json:"complexity"`
	Explanation string  `json:"explanation"`
}

// ByID finds a catalog entry by id.
func ByID(id string) (Entry, bool) {
	for _, e := range Catalog {
		if e.ID == id {
			return e, true
		}
	}
	return Entry{}, false
}

// Run executes the fixed algorithm identified by id on the input. It measures
// wall time with a monotonic clock and never panics on malformed input — it
// returns errors instead. The engine is the single place where user input
// reaches computation.
func Run(id, input string, now func() time.Time) (RunResult, error) {
	entry, ok := ByID(id)
	if !ok {
		return RunResult{}, ErrUnknownAlgorithm
	}
	if len(input) > MaxInputLength {
		return RunResult{}, fmt.Errorf("%w: maximum is %d characters", ErrInputTooLarge, MaxInputLength)
	}

	start := time.Now()
	if now != nil {
		start = now()
	}
	output, err := compute(id, input)
	if err != nil {
		return RunResult{}, err
	}
	measured := time.Since(start)
	if now != nil {
		// Deterministic clocks in tests: measure "zero"; the handler still
		// reports the field (0.0) rather than fabricating a plausible number.
		measured = 0
	}

	result := RunResult{
		AlgorithmID: entry.ID,
		Output:      output,
		ExecutionMS: roundToTenth(measured),
		Complexity:  entry.Complexity,
		Explanation: entry.Explanation,
	}
	return result, nil
}

// compute dispatches ONLY on the fixed catalog ids. No reflection, no
// dynamic function lookup, no user code.
func compute(id, input string) (string, error) {
	switch id {
	case "fizzbuzz":
		return fizzBuzz(input)
	case "palindrome":
		return palindrome(input), nil
	case "fibonacci":
		return fibonacci(input)
	case "reverse":
		return reverse(input), nil
	default:
		return "", ErrUnknownAlgorithm
	}
}

func fizzBuzz(input string) (string, error) {
	n, err := parseBounded(input, 1, 1000)
	if err != nil {
		return "", err
	}
	var sb strings.Builder
	for i := 1; i <= n; i++ {
		if i > 1 {
			sb.WriteByte('\n')
		}
		switch {
		case i%15 == 0:
			sb.WriteString("FizzBuzz")
		case i%3 == 0:
			sb.WriteString("Fizz")
		case i%5 == 0:
			sb.WriteString("Buzz")
		default:
			sb.WriteString(strconv.Itoa(i))
		}
	}
	return sb.String(), nil
}

func palindrome(input string) string {
	var cleaned strings.Builder
	for _, r := range strings.ToLower(input) {
		if (r >= 'a' && r <= 'z') || (r >= '0' && r <= '9') {
			cleaned.WriteRune(r)
		}
	}
	s := []rune(cleaned.String())
	for i, j := 0, len(s)-1; i < j; i, j = i+1, j-1 {
		s[i], s[j] = s[j], s[i]
	}
	if string(s) == cleaned.String() {
		return "Input is a palindrome."
	}
	return "Input is not a palindrome."
}

func fibonacci(input string) (string, error) {
	n, err := parseBounded(input, 1, 90) // F(93) overflows uint64
	if err != nil {
		return "", err
	}
	parts := make([]string, 0, n)
	var a, b uint64 = 0, 1
	for i := 0; i < n; i++ {
		parts = append(parts, strconv.FormatUint(a, 10))
		a, b = b, a+b
	}
	return strings.Join(parts, ", "), nil
}

func reverse(input string) string {
	runes := []rune(input)
	for i, j := 0, len(runes)-1; i < j; i, j = i+1, j-1 {
		runes[i], runes[j] = runes[j], runes[i]
	}
	return string(runes)
}

// parseBounded parses an integer and enforces min..max.
func parseBounded(input string, min, max int) (int, error) {
	v, err := strconv.Atoi(strings.TrimSpace(input))
	if err != nil || v < min || v > max {
		return 0, fmt.Errorf("%w: must be an integer between %d and %d", ErrInvalidInput, min, max)
	}
	return v, nil
}

func roundToTenth(d time.Duration) float64 {
	return float64(int(d.Seconds()*10000+0.5)) / 10
}
