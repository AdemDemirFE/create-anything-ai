package com.createanything.stack02.algorithm;

/**
 * The FIXED algorithm catalog behind screen 4 (workbench). Only these
 * algorithms are executable — arbitrary user code never runs.
 */
public enum AlgorithmCatalog {

    REVERSE("reverse", "Reverse text", "O(n)", "Walks the input once and builds the reversed string."),
    PALINDROME("palindrome", "Palindrome check", "O(n)", "Two-pointer scan comparing characters from both ends."),
    FIZZBUZZ("fizzbuzz", "FizzBuzz 1..n", "O(n)", "Single pass emitting Fizz/Buzz/FizzBuzz multiples."),
    WORDCOUNT("wordcount", "Word count", "O(n)", "Whitespace tokenizer with a single counting pass.");

    private final String id;
    private final String label;
    private final String complexity;
    private final String explanation;

    AlgorithmCatalog(String id, String label, String complexity, String explanation) {
        this.id = id;
        this.label = label;
        this.complexity = complexity;
        this.explanation = explanation;
    }

    public String getId() {
        return id;
    }

    public String getLabel() {
        return label;
    }

    public String getComplexity() {
        return complexity;
    }

    public String getExplanation() {
        return explanation;
    }

    public static AlgorithmCatalog byId(String id) {
        for (AlgorithmCatalog algorithm : values()) {
            if (algorithm.id.equals(id)) {
                return algorithm;
            }
        }
        return null;
    }
}
