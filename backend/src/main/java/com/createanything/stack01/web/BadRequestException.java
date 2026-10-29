package com.createanything.stack01.web;

/** Thrown for client errors with a stable machine-readable code. */
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
