package com.createanything.stack01.web;

/**
 * Thrown when the login throttle budget is exhausted. Maps to HTTP 429
 * (Too Many Requests) with a Retry-After header - NOT 400, which would
 * wrongly frame rate limiting as a client payload problem.
 */
public class RateLimitedException extends RuntimeException {

    private final String code;

    public RateLimitedException(String message) {
        super(message);
        this.code = "RATE_LIMITED";
    }

    public String getCode() {
        return code;
    }
}
