package com.createanything.stack01.algorithm;

import java.util.List;

/**
 * Fixed, safe algorithms only. The workbench never evaluates user-supplied
 * code; callers select from this catalog by id. Each algorithm declares its
 * theoretical Big-O so the API can distinguish measured duration from
 * complexity claims.
 */
public enum AlgorithmCatalog {

    FIZZBUZZ("fizzbuzz", "FizzBuzz", "O(n)",
            "Prints one line per number from 1 to n; multiples of 3 become Fizz, of 5 Buzz, of both FizzBuzz."),
    PALINDROME("palindrome", "Palindrome check", "O(n)",
            "Checks whether the input text reads the same forwards and backwards (case-insensitive)."),
    FIBONACCI("fibonacci", "Fibonacci sequence", "O(n)",
            "Returns the first n Fibonacci numbers using an iterative loop."),
    REVERSE("reverse", "Reverse text", "O(n)",
            "Reverses the characters of the input text.");

    private final String id;
    private final String displayName;
    private final String complexity;
    private final String explanation;

    AlgorithmCatalog(String id, String displayName, String complexity, String explanation) {
        this.id = id;
        this.displayName = displayName;
        this.complexity = complexity;
        this.explanation = explanation;
    }

    public static List<AlgorithmCatalog> all() {
        return List.of(values());
    }

    public static AlgorithmCatalog byId(String id) {
        for (AlgorithmCatalog a : values()) {
            if (a.id.equalsIgnoreCase(id)) {
                return a;
            }
        }
        return null;
    }

    public String getId() {
        return id;
    }

    public String getDisplayName() {
        return displayName;
    }

    public String getComplexity() {
        return complexity;
    }

    public String getExplanation() {
        return explanation;
    }
}
