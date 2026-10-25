package com.createanything.stack02.web;

/**
 * Thrown when a client exceeds a configured rate limit. Maps to HTTP 429 with
 * a {@code Retry-After} header (seconds, from {@code app.throttle.*} config —
 * see {@link com.createanything.stack02.config.ThrottleProperties}).
 */
public class RateLimitedException extends RuntimeException {

    public RateLimitedException(String message) {
        super(message);
    }
}
