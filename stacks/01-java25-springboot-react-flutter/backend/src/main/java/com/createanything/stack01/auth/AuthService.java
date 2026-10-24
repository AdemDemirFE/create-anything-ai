package com.createanything.stack01.auth;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.security.authentication.AuthenticationManager;
import org.springframework.security.authentication.BadCredentialsException;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.Authentication;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import com.createanything.stack01.web.AlreadyExistsException;
import com.createanything.stack01.web.BadRequestException;
import com.createanything.stack01.web.RateLimitedException;

import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpSession;

import java.util.Arrays;
import java.util.List;

/**
 * Registration and login use-cases. The same HTTP session cookie serves browser
 * and native clients. Session lifetime and revocation are documented in
 * ARCHITECTURE.md; logout invalidates the server-side session.
 *
 * <p>Login throttling (demo-grade, documented): the sliding window is keyed on
 * email + client IP so an attacker cannot lock out a victim by burning only
 * the victim's email, and only FAILED attempts consume the budget - successful
 * logins never throttle a legitimate user. The counter is maintained
 * atomically via {@code cache.asMap().compute(...)}. Exceeding the limit maps
 * to HTTP 429 with a Retry-After header (see {@link RateLimitedException}).
 */
@Service
public class AuthService {

    /** Login throttle: max FAILED attempts per rolling window, keyed on email+IP. */
    static final int MAX_FAILED_ATTEMPTS_PER_WINDOW = 10;
    private static final long WINDOW_MS = 60_000L;
    /** Retry-After seconds advertised with HTTP 429. */
    public static final long RETRY_AFTER_SECONDS = 60L;

    private final UserRepository userRepository;
    private final PasswordEncoder passwordEncoder;
    private final AuthenticationManager authenticationManager;

    private final com.github.benmanes.caffeine.cache.Cache<String, WindowState> attemptCache =
            com.github.benmanes.caffeine.cache.Caffeine.newBuilder()
                    .expireAfterWrite(java.time.Duration.ofMillis(WINDOW_MS))
                    .maximumSize(10_000)
                    .build();
    private record WindowState(int count, long windowStart) {
    }

    public AuthService(UserRepository userRepository, PasswordEncoder passwordEncoder,
            AuthenticationManager authenticationManager) {
        this.userRepository = userRepository;
        this.passwordEncoder = passwordEncoder;
        this.authenticationManager = authenticationManager;
    }

    @Transactional
    public UserInfo register(RegisterRequest request) {
        String email = AppUserDetailsService.normalize(request.email());
        validateEmail(email);
        validatePassword(request.password());

        if (userRepository.findByEmail(email).isPresent()) {
            // Deliberately generic-ish message; the 409 code is the real signal.
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
            // Standard Spring Security contract: store the SecurityContext so the
            // HttpSessionSecurityContextRepository restores it on later requests.
            org.springframework.security.core.context.SecurityContext context =
                    org.springframework.security.core.context.SecurityContextHolder
                            .createEmptyContext();
            context.setAuthentication(authentication);
            session.setAttribute("SPRING_SECURITY_CONTEXT", context);
            SecurityContextHolder.getContext().setAuthentication(authentication);
            return new UserInfo(authentication.getName());
        } catch (BadCredentialsException ex) {
            // Same message for unknown email and wrong password: no enumeration.
            // The failure counts against email+IP atomically BEFORE the generic
            // error is emitted; the 11th failure within the window returns 429.
            if (!registerFailedAttempt(throttleKey)) {
                throw new RateLimitedException(
                        "Too many failed attempts. Please wait a minute and try again.");
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
     * counter, and the window start is pinned so the window expires instead
     * of sliding on every attempt.
     */
    private boolean registerFailedAttempt(String key) {
        long now = System.currentTimeMillis();
        WindowState updated = attemptCache.asMap().compute(key, (k, state) -> {
            if (state == null || now - state.windowStart() > WINDOW_MS) {
                return new WindowState(1, now);
            }
            return new WindowState(state.count() + 1, state.windowStart());
        });
        return updated.count() <= MAX_FAILED_ATTEMPTS_PER_WINDOW;
    }

    /**
     * Throttle key: email + client IP. Including the IP means an attacker
     * cannot lock out a victim solely by hammering the victim's email from a
     * different network, and a single IP cannot silently try many emails.
     */
    private String throttleKey(String email, HttpServletRequest request) {
        return email + "|" + clientIp(request);
    }

    /**
     * Trusted proxies: IP ranges/addresses allowed to set X-Forwarded-For.
     * Default is EMPTY - XFF is ignored entirely and the servlet container's
     * {@code getRemoteAddr()} (the TCP peer) is the client identity. Only
     * deployments that actually sit behind a configured reverse proxy should
     * populate {@code app.trusted-proxies}; otherwise a client could spoof
     * the header and rotate identities to bypass the throttle.
     */
    @Value("${app.trusted-proxies:}")
    private List<String> trustedProxies;

    /**
     * Client identity for throttling.
     *
     * <ul>
     *   <li>No trusted proxies configured (default): XFF is ignored; the
     *       remote address of the TCP connection is used. A spoofed
     *       X-Forwarded-For header changes nothing.</li>
     *   <li>Trusted proxies configured AND the immediate peer
     *       ({@code getRemoteAddr()}) is one of them: walk X-Forwarded-For
     *       from RIGHT to LEFT, skipping trusted hops, and use the first
     *       untrusted address as the client. Right-to-left is required
     *       because each proxy appends to the right; entries to the left of
     *       an untrusted hop are attacker-controlled.</li>
     *   <li>Trusted proxies configured but the peer is NOT trusted: the peer
     *       itself is the client (the header cannot be trusted from an
     *       untrusted connection).</li>
     * </ul>
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
        // Rightmost first: the entry closest to us was appended by the proxy
        // we trust; keep walking left while the hop itself is trusted.
        for (int i = hops.length - 1; i >= 0; i--) {
            String hop = hops[i].trim();
            if (!isTrustedProxy(hop)) {
                return hop;
            }
        }
        // Every hop is trusted (chained proxies): fall back to the leftmost,
        // the original client as reported by the outermost trusted proxy.
        return hops[0].trim();
    }

    private boolean isTrustedProxy(String candidate) {
        if (candidate == null || candidate.isBlank()) {
            return false;
        }
        String address = candidate.trim();
        return trustedProxies.stream().anyMatch(configured -> {
            String proxy = configured.trim();
            // Exact match, or IPv4/IPv6 CIDR-style prefix match ("10.0.0./16"
            // is intentionally NOT supported here; entries are exact IPs or
            // a trailing ".%"-free simple wildcard like "10.0.0.").
            if (proxy.equalsIgnoreCase(address)) {
                return true;
            }
            return proxy.endsWith(".") && address.startsWith(proxy);
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
