package com.createanything.stack02.config;

import java.util.UUID;

import org.springframework.boot.context.properties.ConfigurationProperties;

/**
 * Config-driven throttle settings (application.yml {@code app.throttle.*}).
 *
 * <ul>
 *   <li>{@code login-max-failed-attempts} / {@code login-window-seconds} —
 *       FAILED login attempts per identity (email+IP) per fixed window,
 *       gated BEFORE authentication (see AuthService).</li>
 *   <li>{@code register-max-per-window} / {@code register-window-seconds} —
 *       registration attempts per client IP per fixed window (abuse
 *       mitigation for bulk account creation; generous default so normal
 *       sign-up flows never hit it).</li>
 *   <li>{@code retry-after-seconds} — the {@code Retry-After} header value
 *       advertised with HTTP 429. The header is generated from this value,
 *       so operators tune it without touching code.</li>
 * </ul>
 */
@ConfigurationProperties(prefix = "app.throttle")
public class ThrottleProperties {

    /** Max FAILED login attempts per identity per window. */
    private int loginMaxFailedAttempts = 10;

    /** Fixed window length in seconds for the login throttle. */
    private int loginWindowSeconds = 60;

    /** Max registration attempts per client IP per register window. */
    private int registerMaxPerWindow = 30;

    /** Fixed window length in seconds for the register throttle. */
    private int registerWindowSeconds = 60;

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

    public int getRegisterMaxPerWindow() {
        return registerMaxPerWindow;
    }

    public void setRegisterMaxPerWindow(int registerMaxPerWindow) {
        this.registerMaxPerWindow = registerMaxPerWindow;
    }

    public int getRegisterWindowSeconds() {
        return registerWindowSeconds;
    }

    public void setRegisterWindowSeconds(int registerWindowSeconds) {
        this.registerWindowSeconds = registerWindowSeconds;
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
