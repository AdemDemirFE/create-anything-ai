package com.createanything.stack02;

import org.junit.jupiter.api.Test;

import com.createanything.stack02.algorithm.AlgorithmCatalog;
import com.createanything.stack02.algorithm.AlgorithmEngine;
import com.createanything.stack02.algorithm.InputTooLargeException;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

/**
 * The four fixed algorithms: golden-path outputs, bounded input rejection,
 * and the measured-vs-theoretical separation contract.
 * Test literals are dictionary-style words (no leetspeak).
 */
class AlgorithmEngineTest {

    @Test
    void reverseProducesReversedText() {
        AlgorithmEngine.Result result = AlgorithmEngine.run(AlgorithmCatalog.REVERSE, "lanterncreek");
        assertThat(result.output()).isEqualTo("keercnretnal");
        assertThat(result.complexity()).isEqualTo("O(n)");
        assertThat(result.executionMs()).isGreaterThanOrEqualTo(0.0);
        // Measured duration and theoretical complexity are separate fields.
        assertThat(result.explanation()).isNotBlank();
    }

    @Test
    void palindromeClassifies() {
        // Spaces ignored, case-insensitive: "never a foot too far" reversed is
        // "raf oot toof a reven" — NOT equal, so use a true phrase palindrome.
        assertThat(AlgorithmEngine.run(AlgorithmCatalog.PALINDROME, "Never odd or even").output())
                .isEqualTo("is-a-palindrome");
        assertThat(AlgorithmEngine.run(AlgorithmCatalog.PALINDROME, "open meadow").output())
                .isEqualTo("not-a-palindrome");
    }

    @Test
    void wordCountCountsWhitespaceSeparatedWords() {
        assertThat(AlgorithmEngine.run(AlgorithmCatalog.WORDCOUNT, "harbor lantern meadow").output())
                .isEqualTo("3");
        assertThat(AlgorithmEngine.run(AlgorithmCatalog.WORDCOUNT, "solo").output()).isEqualTo("1");
    }

    @Test
    void fizzBuzzMatchesMultiples() {
        String output = AlgorithmEngine.run(AlgorithmCatalog.FIZZBUZZ, "15").output();
        String[] lines = output.split("\n");
        assertThat(lines).hasSize(15);
        assertThat(lines[14]).isEqualTo("FizzBuzz");
        assertThat(lines[2]).isEqualTo("Fizz");
        assertThat(lines[4]).isEqualTo("Buzz");
        assertThat(lines[0]).isEqualTo("1");
    }

    @Test
    void fizzBuzzRejectsOutOfRangeNumbers() {
        assertThatThrownBy(() -> AlgorithmEngine.run(AlgorithmCatalog.FIZZBUZZ, "1001"))
                .isInstanceOf(IllegalArgumentException.class);
        assertThatThrownBy(() -> AlgorithmEngine.run(AlgorithmCatalog.FIZZBUZZ, "zero"))
                .isInstanceOf(IllegalArgumentException.class);
    }

    @Test
    void blankInputIsRejected() {
        assertThatThrownBy(() -> AlgorithmEngine.run(AlgorithmCatalog.REVERSE, "   "))
                .isInstanceOf(IllegalArgumentException.class);
        assertThatThrownBy(() -> AlgorithmEngine.run(AlgorithmCatalog.WORDCOUNT, ""))
                .isInstanceOf(IllegalArgumentException.class);
    }

    @Test
    void oversizedInputIsRejectedWithBound() {
        String oversized = "river".repeat(2_001); // 10_005 chars > 10_000
        assertThatThrownBy(() -> AlgorithmEngine.run(AlgorithmCatalog.REVERSE, oversized))
                .isInstanceOf(InputTooLargeException.class)
                .hasMessageContaining("10_000".replace("_", ""));
    }

    @Test
    void unknownAlgorithmIdIsNotResolvable() {
        assertThat(AlgorithmCatalog.byId("does-not-exist")).isNull();
        assertThat(AlgorithmCatalog.byId("reverse")).isEqualTo(AlgorithmCatalog.REVERSE);
    }
}
