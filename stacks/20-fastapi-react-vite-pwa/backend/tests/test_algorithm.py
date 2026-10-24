"""Unit tests: fixed algorithm catalog — correctness, bounds, safety."""

from __future__ import annotations

import pytest

from app import config
from app.algorithm.catalog import (
    CATALOG,
    InputTooLargeError,
    run_algorithm,
)


class TestCatalogContent:
    def test_catalog_has_expected_entries(self) -> None:
        assert set(CATALOG.keys()) == {
            "fizzbuzz",
            "reverse",
            "palindrome",
            "fibonacci",
            "word-count",
        }

    def test_every_entry_documents_complexity_and_explanation(self) -> None:
        for spec in CATALOG.values():
            assert spec.complexity.startswith("O("), spec.id
            assert len(spec.explanation) > 10, spec.id
            assert spec.name

    def test_catalog_is_safe_no_user_code_path(self) -> None:
        """The catalog maps ids to fixed functions; no eval/exec anywhere."""
        import inspect

        import app.algorithm.catalog as module

        source = inspect.getsource(module)
        assert "eval(" not in source
        assert "exec(" not in source
        assert "__import__" not in source


class TestFizzBuzz:
    def test_small_sequence(self) -> None:
        output, _ = run_algorithm("fizzbuzz", "5")
        assert output == "1\n2\nFizz\n4\nBuzz"

    def test_fifteen(self) -> None:
        output, _ = run_algorithm("fizzbuzz", "15")
        assert output.splitlines()[14] == "FizzBuzz"

    def test_out_of_range_rejected(self) -> None:
        with pytest.raises(ValueError):
            run_algorithm("fizzbuzz", "0")
        with pytest.raises(ValueError):
            run_algorithm("fizzbuzz", "1001")

    def test_non_numeric_rejected(self) -> None:
        with pytest.raises(ValueError):
            run_algorithm("fizzbuzz", "abc")


class TestReverse:
    def test_reverses_text(self) -> None:
        output, _ = run_algorithm("reverse", "hello")
        assert output == "olleh"

    def test_unicode_roundtrip(self) -> None:
        output, _ = run_algorithm("reverse", "ığşöç")
        assert output == "çöşğı"


class TestPalindrome:
    def test_positive(self) -> None:
        output, _ = run_algorithm("palindrome", "Racecar")
        assert "palindrome: true" in output

    def test_negative(self) -> None:
        output, _ = run_algorithm("palindrome", "hello")
        assert "palindrome: false" in output

    def test_ignores_punctuation_and_case(self) -> None:
        output, _ = run_algorithm("palindrome", "A man, a plan, a canal: Panama!")
        assert "palindrome: true" in output


class TestFibonacci:
    def test_first_values(self) -> None:
        output, _ = run_algorithm("fibonacci", "7")
        assert output == "0,1,1,2,3,5,8"

    def test_out_of_range_rejected(self) -> None:
        with pytest.raises(ValueError):
            run_algorithm("fibonacci", "0")
        with pytest.raises(ValueError):
            run_algorithm("fibonacci", "91")


class TestWordCount:
    def test_counts_words_and_unique(self) -> None:
        output, _ = run_algorithm("word-count", "the cat the dog the bird")
        assert "words: 6" in output
        assert "unique (case-insensitive): 4" in output


class TestBounds:
    def test_oversized_input_rejected_before_execution(self) -> None:
        oversized = "x" * (config.MAX_INPUT_LENGTH + 1)
        with pytest.raises(InputTooLargeError):
            run_algorithm("reverse", oversized)

    def test_input_at_cap_is_allowed(self) -> None:
        at_cap = "a" * config.MAX_INPUT_LENGTH
        output, _ = run_algorithm("reverse", at_cap)
        assert len(output) == config.MAX_INPUT_LENGTH

    def test_unknown_id_raises_keyerror(self) -> None:
        with pytest.raises(KeyError):
            run_algorithm("does-not-exist", "irrelevant")


class TestDurationVsComplexity:
    def test_measured_duration_is_not_a_big_o_claim(self) -> None:
        """The catalog reports theoretical complexity as a static string and
        measured duration is taken from the monotonic clock at the route
        layer — the two are distinct concepts and distinct fields."""
        spec = CATALOG["fizzbuzz"]
        assert spec.complexity == "O(n)"
        # The spec itself never contains a duration; duration comes only
        # from measured_execution_ms at request time.
        assert not hasattr(spec, "duration")
