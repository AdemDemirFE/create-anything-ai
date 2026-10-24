"""Fixed, bounded algorithm catalog — no user-supplied code ever executes.

Mirrors the sibling stacks' workbench contract: a closed catalog, dispatch by
exact-name switch, bounded input (MAX_INPUT_CHARS via the caller), per-
algorithm numeric ranges, monotonic-clock measured duration reported
separately from static Big-O strings.
"""

from __future__ import annotations

import time
from dataclasses import dataclass
from typing import Callable


@dataclass(frozen=True)
class AlgorithmSpec:
    name: str
    title: str
    description: str
    complexity: str
    func: Callable[[str], str]


def _fizzbuzz(n: int) -> str:
    return "\n".join(
        "FizzBuzz" if i % 15 == 0 else "Fizz" if i % 3 == 0 else "Buzz" if i % 5 == 0 else str(i)
        for i in range(1, n + 1)
    )


def _palindrome(s: str) -> str:
    cleaned = "".join(ch.lower() for ch in s if ch.isalnum())
    return "true" if cleaned == cleaned[::-1] else "false"


def _fibonacci(n: int) -> str:
    a, b = 0, 1
    parts: list[str] = []
    for _ in range(n):
        parts.append(str(a))
        a, b = b, a + b
    return ", ".join(parts)


def _reverse(s: str) -> str:
    return s[::-1]


def _wordcount(s: str) -> str:
    return str(len(s.split()))


_CATALOG: dict[str, AlgorithmSpec] = {
    spec.name: spec
    for spec in (
        AlgorithmSpec(
            name="fizzbuzz",
            title="FizzBuzz",
            description="Prints 1..n with multiples of 3, 5, or both replaced.",
            complexity="O(n)",
            func=lambda s: _fizzbuzz(_bounded_int(s, 1, 500)),
        ),
        AlgorithmSpec(
            name="palindrome",
            title="Palindrome check",
            description="True when the input reads the same ignoring case and punctuation.",
            complexity="O(n)",
            func=_palindrome,
        ),
        AlgorithmSpec(
            name="fibonacci",
            title="Fibonacci sequence",
            description="First n Fibonacci numbers.",
            complexity="O(n)",
            func=lambda s: _fibonacci(_bounded_int(s, 1, 90)),
        ),
        AlgorithmSpec(
            name="reverse",
            title="Reverse string",
            description="Reverses the input text.",
            complexity="O(n)",
            func=_reverse,
        ),
        AlgorithmSpec(
            name="wordcount",
            title="Word count",
            description="Counts whitespace-separated words in the input.",
            complexity="O(n)",
            func=_wordcount,
        ),
    )
}

# Per-algorithm numeric bounds for the integer-argument algorithms.
INT_BOUNDS: dict[str, tuple[int, int]] = {
    "fizzbuzz": (1, 500),
    "fibonacci": (1, 90),
}


def _bounded_int(raw: str, minimum: int, maximum: int) -> int:
    text = raw.strip()
    if not text:
        raise ValueError("an integer is required")
    if len(text) > 12:
        raise ValueError("integer out of range")
    try:
        value = int(text, 10)
    except ValueError as exc:
        raise ValueError("a valid integer is required") from exc
    if value < minimum or value > maximum:
        raise ValueError(f"integer must be between {minimum} and {maximum}")
    return value


def catalog() -> list[dict]:
    """Stable metadata list for templates and the JSON API."""
    return [
        {
            "name": spec.name,
            "title": spec.title,
            "description": spec.description,
            "complexity": spec.complexity,
        }
        for spec in _CATALOG.values()
    ]


def known(name: str) -> bool:
    return name in _CATALOG


def run(name: str, raw_input: str) -> tuple[str, int, str]:
    """Execute a catalog algorithm.

    Returns (output, duration_ms, complexity). Raises ValueError for invalid
    input and KeyError for unknown names. Never executes user code: dispatch
    is a closed dict lookup.
    """
    spec = _CATALOG[name]  # KeyError if unknown — callers check known() first
    start = time.perf_counter()
    output = spec.func(raw_input)
    duration_ms = int((time.perf_counter() - start) * 1000)
    return output, duration_ms, spec.complexity
