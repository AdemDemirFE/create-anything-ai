package com.createanything.stack02.web;

/**
 * Thrown by use-cases that map to HTTP 400 with an envelope error. Carries a
 * stable machine-readable code and a safe message.
 */
public class BadRequestException extends RuntimeException {

    private final String code;

    public BadRequestException(String code, String message) {
        super(message);
        this.code = code;
    }

    public String getCode() {
        return code;
    }
}
