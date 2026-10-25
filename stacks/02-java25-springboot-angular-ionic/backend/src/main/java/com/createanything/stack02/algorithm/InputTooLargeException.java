package com.createanything.stack02.algorithm;

/**
 * Input exceeded {@link AlgorithmEngine#MAX_INPUT_LENGTH}. Maps to HTTP 413
 * with a safe envelope message.
 */
public class InputTooLargeException extends RuntimeException {

    private final int max;

    public InputTooLargeException(int max) {
        super("Input exceeds the maximum length of " + max + " characters.");
        this.max = max;
    }

    public int getMax() {
        return max;
    }
}
