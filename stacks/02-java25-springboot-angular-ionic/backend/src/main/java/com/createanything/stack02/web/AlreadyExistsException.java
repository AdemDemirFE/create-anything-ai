package com.createanything.stack02.web;

/**
 * Thrown by use-cases that map to HTTP 409 with an envelope error, e.g.
 * registering an email that already exists.
 */
public class AlreadyExistsException extends RuntimeException {

    private final String code;

    public AlreadyExistsException(String code, String message) {
        super(message);
        this.code = code;
    }

    public String getCode() {
        return code;
    }
}
