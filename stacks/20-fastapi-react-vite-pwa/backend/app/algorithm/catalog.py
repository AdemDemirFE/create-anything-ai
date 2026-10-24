"""Fixed, bounded, safe algorithm catalog — the only runnable code.

Security model:
- The catalog is a hard-coded mapping. There is no code-execution path for
  user input; `input` is always treated as *data*.
- Input is bounded at MAX_INPUT_LENGTH characters (enforced again here,
  defense in depth, after the Pydantic schema bound).
- Each entry documents its theoretical Big-O, which the UI must display
  separately from the measured wall-clock duration.

Implementations are intentionally simple, deterministic, and allocation-
bounded: even at the 10,000-char cap, every algorithm finishes in
milliseconds to low seconds on commodity hardware.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Callable

from app import config


@dataclass(frozen=True)
class AlgorithmSpec:
    id: str
    name: str
    complexity: str
    explanation: str
    run: Callable[[str], str]


def _fizzbuzz(n: int) -> str:
    lines: list[str] = []
    for i in range(1, n + 1):
        if i % 15 == 0:
            lines.append("FizzBuzz")
        elif i % 3 == 0:
            lines.append("Fizz")
        elif i % 5 == 0:
            lines.append("Buzz")
        else:
            lines.append(str(i))
    return "\n".join(lines)


def _run_fizzbuzz(input_text: str) -> str:
    n = int(input_text.strip())
    if n < 1 or n > 1000:
        raise ValueError("n must be between 1 and 1000")
    return _fizzbuzz(n)


def _run_reverse(input_text: str) -> str:
    return input_text[::-1]


def _run_palindrome(input_text: str) -> str:
    normalized = "".join(ch.lower() for ch in input_text if ch.isalnum())
    is_palindrome = normalized == normalized[::-1]
    return (
        f"palindrome: {str(is_palindrome).lower()}\n"
        f"normalized length: {len(normalized)}"
    )


def _run_fibonacci(input_text: str) -> str:
    n = int(input_text.strip())
    if n < 1 or n > 90:
        # Cap keeps iterated Fibonacci within exact integer ranges fast; no
        # naive recursion is used, so this is a policy bound, not a
        # complexity necessity.
        raise ValueError("n must be between 1 and 90")
    a, b = 0, 1
    values: list[str] = []
    for _ in range(n):
        values.append(str(a))
        a, b = b, a + b
    return ",".join(values)


def _run_word_count(input_text: str) -> str:
    words = input_text.split()
    unique = len({w.lower() for w in words})
    return f"words: {len(words)}\nunique (case-insensitive): {unique}"


CATALOG: dict[str, AlgorithmSpec] = {
    spec.id: spec
    for spec in (
        AlgorithmSpec(
            id="fizzbuzz",
            name="FizzBuzz",
            complexity="O(n)",
            explanation="Builds one line per number from 1 to n; linear in output size.",
            run=_run_fizzbuzz,
        ),
        AlgorithmSpec(
            id="reverse",
            name="Reverse text",
            complexity="O(n)",
            explanation="Single reversed copy of the input string.",
            run=_run_reverse,
        ),
        AlgorithmSpec(
            id="palindrome",
            name="Palindrome check",
            complexity="O(n)",
            explanation="Normalizes (alphanumeric, lowercased) then compares with its reverse.",
            run=_run_palindrome,
        ),
        AlgorithmSpec(
            id="fibonacci",
            name="Fibonacci sequence (iterative)",
            complexity="O(n)",
            explanation="Iterative pairwise addition; no recursion, constant auxiliary space.",
            run=_run_fibonacci,
        ),
        AlgorithmSpec(
            id="word-count",
            name="Word count",
            complexity="O(n)",
            explanation="Whitespace split plus one pass over words for the unique set.",
            run=_run_word_count,
        ),
    )
}

# Bound re-check: the engine refuses anything longer than the global input
# cap regardless of what the schema layer allowed.
MAX_INPUT_LENGTH = config.MAX_INPUT_LENGTH


def run_algorithm(algorithm_id: str, input_text: str) -> tuple[str, AlgorithmSpec]:
    """Run one catalog algorithm on bounded input.

    Raises KeyError for unknown ids and ValueError for malformed/out-of-range
    input. Returns (output, spec).
    """
    if len(input_text) > MAX_INPUT_LENGTH:
        raise InputTooLargeError(len(input_text))
    spec = CATALOG[algorithm_id]  # KeyError propagates by design
    try:
        output = spec.run(input_text)
    except ValueError:
        raise
    return output, spec


class InputTooLargeError(ValueError):
    def __init__(self, actual_length: int) -> None:
        super().__init__(
            f"Input exceeds the maximum length of {MAX_INPUT_LENGTH} characters "
            f"(got {actual_length})."
        )
        self.actual_length = actual_length
