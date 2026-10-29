package com.createanything.stack01.web;

/** Thrown for conflict situations (e.g. duplicate email) with a stable error code. */
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
