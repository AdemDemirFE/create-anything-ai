package com.createanything.stack02.auth;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.security.authentication.AuthenticationManager;
import org.springframework.security.authentication.BadCredentialsException;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.Authentication;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import com.createanything.stack02.config.ThrottleProperties;
import com.createanything.stack02.web.AlreadyExistsException;
import com.createanything.stack02.web.BadRequestException;
import com.createanything.stack02.web.RateLimitedException;

import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpSession;

/**
 * Registration and login use-cases. The same HTTP session cookie serves
 * browser and native (Ionic/Capacitor) clients; logout invalidates the
 * server-side session. Session lifetime is documented in ARCHITECTURE.md.
 *
 * <p>Login throttling (demo-grade, documented): a fixed window keyed on
 * normalized email + client IP so an attacker cannot lock out a victim by
 * burning only the victim's email, and only FAILED attempts consume the
 * budget — successful logins never throttle a legitimate user. Bounds and
 * the advertised Retry-After come from {@link ThrottleProperties} (config,
 * not constants). Exceeding the limit maps to HTTP 429 with Retry-After.
 */
@Service
public class AuthService {

    private final UserRepository userRepository;
    private final PasswordEncoder passwordEncoder;
    private final AuthenticationManager authenticationManager;
    private final ThrottleProperties throttle;

    private final com.github.benmanes.caffeine.cache.Cache<String, WindowState> attemptCache =
            com.github.benmanes.caffeine.cache.Caffeine.newBuilder()
                    .expireAfterWrite(java.time.Duration.ofMinutes(10))
                    .maximumSize(10_000)
                    .build();
    private record WindowState(int count, long windowStart) {
    }

    public AuthService(UserRepository userRepository, PasswordEncoder passwordEncoder,
            AuthenticationManager authenticationManager, ThrottleProperties throttle) {
        this.userRepository = userRepository;
        this.passwordEncoder = passwordEncoder;
        this.authenticationManager = authenticationManager;
        this.throttle = throttle;
    }

    @Transactional
    public UserInfo register(RegisterRequest request) {
        // Normalize BEFORE the unique check AND the insert: the persistence
        // layer only ever sees the canonical form, so MixedCase@Example.com
        // and mixedcase@example.com are the same account.
        String email = AppUserDetailsService.normalize(request.email());
        validateEmail(email);
        validatePassword(request.password());

        if (userRepository.findByEmail(email).isPresent()) {
            throw new AlreadyExistsException("EMAIL_TAKEN",
                    "An account with this email already exists.");
        }

        User user = new User(email, passwordEncoder.encode(request.password()));
        userRepository.save(user);
        return UserInfo.from(user);
    }

    @Transactional(readOnly = true)
    public UserInfo login(LoginRequest request, HttpServletRequest httpRequest) {
        String email = AppUserDetailsService.normalize(request.email());
        String throttleKey = throttleKey(email, httpRequest);

        try {
            Authentication authentication = authenticationManager.authenticate(
                    new UsernamePasswordAuthenticationToken(email, request.password()));
            // Successful login clears the failure tally for this identity pair
            // (documented policy): successes never accumulate and a legitimate
            // user recovers immediately even after a burst of typos.
            attemptCache.invalidate(throttleKey);
            HttpSession oldSession = httpRequest.getSession(false);
            if (oldSession != null) {
                oldSession.invalidate(); // prevent session fixation
            }
            HttpSession session = httpRequest.getSession(true);
            // Standard Spring Security contract: store the SecurityContext so
            // the session restores it on later requests.
            org.springframework.security.core.context.SecurityContext context =
                    org.springframework.security.core.context.SecurityContextHolder
                            .createEmptyContext();
            context.setAuthentication(authentication);
            session.setAttribute("SPRING_SECURITY_CONTEXT", context);
            SecurityContextHolder.getContext().setAuthentication(authentication);
            return new UserInfo(authentication.getName());
        } catch (BadCredentialsException ex) {
            // Same message for unknown email and wrong password: no enumeration.
            // The failure counts against email+IP BEFORE the generic error is
            // emitted; the (N+1)th failure within the window returns 429 with
            // Retry-After.
            if (!registerFailedAttempt(throttleKey)) {
                throw new RateLimitedException(
                        "Too many failed attempts. Please wait before trying again.");
            }
            throw new BadRequestException("INVALID_CREDENTIALS", "Invalid email or password.");
        }
    }

    public void logout(HttpServletRequest request) {
        HttpSession session = request.getSession(false);
        if (session != null) {
            session.invalidate();
        }
        SecurityContextHolder.clearContext();
    }

    /**
     * Atomically records one failed attempt under {@code key} and reports
     * whether the caller is still allowed to retry. Uses
     * {@code cache.asMap().compute(...)} so concurrent logins cannot race the
     * counter; the window start is pinned so the window EXPIRES instead of
     * sliding on every attempt. Bounds come from config
     * ({@code app.throttle.login-max-failed-attempts} /
     * {@code -login-window-seconds}).
     */
    private boolean registerFailedAttempt(String key) {
        long now = System.currentTimeMillis();
        long windowMs = throttle.getLoginWindowSeconds() * 1000L;
        WindowState updated = attemptCache.asMap().compute(key, (k, state) -> {
            if (state == null || now - state.windowStart() > windowMs) {
                return new WindowState(1, now);
            }
            return new WindowState(state.count() + 1, state.windowStart());
        });
        return updated.count() <= throttle.getLoginMaxFailedAttempts();
    }

    /**
     * Throttle key: normalized email + client IP. Including the IP means an
     * attacker cannot lock out a victim solely by hammering the victim's
     * email from a different network.
     */
    private String throttleKey(String email, HttpServletRequest request) {
        return email + "|" + clientIp(request);
    }

    /**
     * Trusted proxies: IP ranges/addresses allowed to set X-Forwarded-For.
     * Default is EMPTY — XFF is ignored entirely and the servlet container's
     * {@code getRemoteAddr()} (the TCP peer) is the client identity. Only
     * deployments that actually sit behind a configured reverse proxy should
     * populate {@code app.trusted-proxies}; otherwise a client could spoof
     * the header and rotate identities to bypass the throttle.
     */
    @Value("${app.trusted-proxies:}")
    private java.util.List<String> trustedProxies;

    /**
     * Client identity for throttling: with no trusted proxies configured
     * (the default) XFF is ignored; otherwise the rightmost untrusted hop of
     * X-Forwarded-For is used, walking right-to-left past trusted proxies.
     */
    private String clientIp(HttpServletRequest request) {
        String remoteAddr = request.getRemoteAddr() == null ? "unknown" : request.getRemoteAddr();
        if (trustedProxies.isEmpty() || !isTrustedProxy(remoteAddr)) {
            return remoteAddr;
        }
        String forwarded = request.getHeader("X-Forwarded-For");
        if (forwarded == null || forwarded.isBlank()) {
            return remoteAddr;
        }
        String[] hops = forwarded.split(",");
        for (int i = hops.length - 1; i >= 0; i--) {
            String hop = hops[i].trim();
            if (!isTrustedProxy(hop)) {
                return hop;
            }
        }
        return hops[0].trim();
    }

    private boolean isTrustedProxy(String candidate) {
        if (candidate == null || candidate.isBlank()) {
            return false;
        }
        String address = candidate.trim();
        return trustedProxies.stream().anyMatch(configured -> {
            String proxy = configured.trim();
            return proxy.equalsIgnoreCase(address)
                    || (proxy.endsWith(".") && address.startsWith(proxy));
        });
    }

    private void validateEmail(String email) {
        if (email == null || !email.matches("^[^@\\s]+@[^@\\s]+\\.[^@\\s]+$") || email.length() > 254) {
            throw new BadRequestException("VALIDATION_ERROR", "The request contains invalid fields.");
        }
    }

    private void validatePassword(String password) {
        if (password == null || password.length() < 10 || password.length() > 128) {
            throw new BadRequestException("VALIDATION_ERROR", "The request contains invalid fields.");
        }
        if (!password.matches(".*[A-Za-z].*") || !password.matches(".*\\d.*")) {
            throw new BadRequestException("VALIDATION_ERROR", "The request contains invalid fields.");
        }
    }

    public record RegisterRequest(
            @jakarta.validation.constraints.NotBlank String email,
            @jakarta.validation.constraints.NotBlank String password) {
    }

    public record LoginRequest(
            @jakarta.validation.constraints.NotBlank String email,
            @jakarta.validation.constraints.NotBlank String password) {
    }

    public record UserInfo(String email) {

        public static UserInfo from(User user) {
            return new UserInfo(user.getEmail());
        }
    }
}
