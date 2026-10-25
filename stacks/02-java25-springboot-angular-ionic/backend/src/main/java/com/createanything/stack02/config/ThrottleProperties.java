package com.createanything.stack02.config;

import java.util.UUID;

import org.springframework.boot.context.properties.ConfigurationProperties;

/**
 * Config-driven throttle settings (application.yml {@code app.throttle.*}).
 *
 * <ul>
 *   <li>{@code login-max-failed-attempts} — max FAILED login attempts per
 *       identity per fixed window (see AuthService).</li>
 *   <li>{@code login-window-seconds} — window length in seconds.</li>
 *   <li>{@code retry-after-seconds} — the {@code Retry-After} header value
 *       advertised with HTTP 429. The header is generated from this value, so
 *       operators tune it without touching code.</li>
 * </ul>
 *
 * Also owns the request-id fallback used by {@code RequestIdFilter} (a
 * server-generated opaque id).
 */
@ConfigurationProperties(prefix = "app.throttle")
public class ThrottleProperties {

    /** Max FAILED login attempts per identity per window. */
    private int loginMaxFailedAttempts = 10;

    /** Fixed window length in seconds. */
    private int loginWindowSeconds = 60;

    /** Retry-After seconds advertised with HTTP 429. */
    private long retryAfterSeconds = 60;

    public int getLoginMaxFailedAttempts() {
        return loginMaxFailedAttempts;
    }

    public void setLoginMaxFailedAttempts(int loginMaxFailedAttempts) {
        this.loginMaxFailedAttempts = loginMaxFailedAttempts;
    }

    public int getLoginWindowSeconds() {
        return loginWindowSeconds;
    }

    public void setLoginWindowSeconds(int loginWindowSeconds) {
        this.loginWindowSeconds = loginWindowSeconds;
    }

    public long getRetryAfterSeconds() {
        return retryAfterSeconds;
    }

    public void setRetryAfterSeconds(long retryAfterSeconds) {
        this.retryAfterSeconds = retryAfterSeconds;
    }

    /** Opaque, server-generated correlation id (UUID v4). */
    public String generatedRequestId() {
        return UUID.randomUUID().toString();
    }
}
