package com.createanything.stack01;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import org.junit.jupiter.api.Test;

import com.createanything.stack01.algorithm.AlgorithmCatalog;
import com.createanything.stack01.algorithm.AlgorithmEngine;
import com.createanything.stack01.algorithm.AlgorithmEngine.InputTooLargeException;

/**
 * Pure unit tests for the bounded, fixed-catalog algorithm engine.
 */
class AlgorithmEngineTest {

    @Test
    void fizzBuzzFollowsTheClassicRules() {
        String out = AlgorithmEngine.run(AlgorithmCatalog.FIZZBUZZ, "15").output();
        String[] lines = out.split("\n");
        assertThat(lines).hasSize(15);
        assertThat(lines[2]).isEqualTo("Fizz");
        assertThat(lines[4]).isEqualTo("Buzz");
        assertThat(lines[14]).isEqualTo("FizzBuzz");
        assertThat(lines[0]).isEqualTo("1");
    }

    @Test
    void palindromeIgnoresCaseAndPunctuation() {
        String out = AlgorithmEngine.run(AlgorithmCatalog.PALINDROME, "A man, a plan, a canal: Panama!")
                .output();
        assertThat(out).isEqualTo("Input is a palindrome.");
        String not = AlgorithmEngine.run(AlgorithmCatalog.PALINDROME, "hello world").output();
        assertThat(not).isEqualTo("Input is not a palindrome.");
    }

    @Test
    void fibonacciReturnsFirstNNumbers() {
        String out = AlgorithmEngine.run(AlgorithmCatalog.FIBONACCI, "10").output();
        assertThat(out).isEqualTo("0, 1, 1, 2, 3, 5, 8, 13, 21, 34");
    }

    @Test
    void reverseReversesText() {
        String out = AlgorithmEngine.run(AlgorithmCatalog.REVERSE, "stack01").output();
        assertThat(out).isEqualTo("10kcats");
    }

    @Test
    void inputBoundsAreEnforced() {
        assertThatThrownBy(() -> AlgorithmEngine.run(AlgorithmCatalog.FIZZBUZZ, "1001"))
                .isInstanceOf(IllegalArgumentException.class);
        assertThatThrownBy(() -> AlgorithmEngine.run(AlgorithmCatalog.REVERSE, "x".repeat(10_001)))
                .isInstanceOf(InputTooLargeException.class);
        assertThatThrownBy(() -> AlgorithmEngine.run(AlgorithmCatalog.FIBONACCI, "not-a-number"))
                .isInstanceOf(IllegalArgumentException.class);
    }

    @Test
    void measuredDurationIsDistinctFromComplexity() {
        var result = AlgorithmEngine.run(AlgorithmCatalog.FIBONACCI, "30");
        assertThat(result.executionMs()).isGreaterThanOrEqualTo(0.0);
        assertThat(result.complexity()).isEqualTo("O(n)");
        assertThat(result.explanation()).isNotBlank();
    }

    @Test
    void catalogContainsOnlyFixedSafeAlgorithms() {
        assertThat(AlgorithmCatalog.all()).hasSize(4);
        assertThat(AlgorithmCatalog.byId("fizzbuzz")).isNotNull();
        assertThat(AlgorithmCatalog.byId("EVAL")).isNull();
    }
}
