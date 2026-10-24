package com.createanything.stack01.algorithm;

import java.util.ArrayList;
import java.util.List;

/**
 * Executes only the fixed algorithms from {@link AlgorithmCatalog}. Input
 * bounds are enforced here (defense in depth: the controller validates too).
 * Timing uses {@link System#nanoTime()}, the JVM's monotonic clock; the API
 * reports measured duration and separately the theoretical complexity.
 */
public final class AlgorithmEngine {

    /** Maximum accepted input length in characters. */
    public static final int MAX_INPUT_LENGTH = 10_000;

    private AlgorithmEngine() {
    }

    public record Result(String algorithmId, String output, double executionMs, String complexity,
            String explanation) {
    }

    public static Result run(AlgorithmCatalog algorithm, String input) {
        if (input == null || input.isBlank()) {
            throw new IllegalArgumentException("Input is required.");
        }
        if (input.length() > MAX_INPUT_LENGTH) {
            throw new InputTooLargeException(MAX_INPUT_LENGTH);
        }

        long startNanos = System.nanoTime();
        String output = switch (algorithm) {
            case FIZZBUZZ -> fizzBuzz(input);
            case PALINDROME -> palindrome(input);
            case FIBONACCI -> fibonacci(input);
            case REVERSE -> reverse(input);
        };
        double ms = Math.round((System.nanoTime() - startNanos) / 1_000_000.0 * 10.0) / 10.0;
        return new Result(algorithm.getId(), output, ms, algorithm.getComplexity(),
                algorithm.getExplanation());
    }

    static String fizzBuzz(String input) {
        int n = parseBoundedInt(input, 1, 1000);
        StringBuilder sb = new StringBuilder();
        for (int i = 1; i <= n; i++) {
            if (i > 1) {
                sb.append('\n');
            }
            if (i % 15 == 0) {
                sb.append("FizzBuzz");
            } else if (i % 3 == 0) {
                sb.append("Fizz");
            } else if (i % 5 == 0) {
                sb.append("Buzz");
            } else {
                sb.append(i);
            }
        }
        return sb.toString();
    }

    static String palindrome(String input) {
        String cleaned = input.replaceAll("[^A-Za-z0-9]", "").toLowerCase();
        String reversed = new StringBuilder(cleaned).reverse().toString();
        boolean isPalindrome = cleaned.equals(reversed);
        return "Input is " + (isPalindrome ? "" : "not ") + "a palindrome.";
    }

    static String fibonacci(String input) {
        int n = parseBoundedInt(input, 1, 90); // long-safe bound
        List<String> parts = new ArrayList<>(n);
        long a = 0;
        long b = 1;
        for (int i = 0; i < n; i++) {
            parts.add(Long.toString(a));
            long next = a + b;
            a = b;
            b = next;
        }
        return String.join(", ", parts);
    }

    static String reverse(String input) {
        return new StringBuilder(input).reverse().toString();
    }

    private static int parseBoundedInt(String input, int min, int max) {
        try {
            int value = Integer.parseInt(input.trim());
            if (value < min || value > max) {
                throw new IllegalArgumentException(
                        "Input must be an integer between " + min + " and " + max + ".");
            }
            return value;
        } catch (NumberFormatException ex) {
            throw new IllegalArgumentException(
                    "Input must be an integer between " + min + " and " + max + ".");
        }
    }

    public static final class InputTooLargeException extends RuntimeException {
        public InputTooLargeException(int max) {
            super("Input exceeds the maximum length of " + max + " characters.");
        }
    }
}
