package com.createanything.stack01.auth;

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

import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpSession;

/**
 * Registration and login use-cases. The same HTTP session cookie serves browser
 * and native clients. Session lifetime and revocation are documented in
 * ARCHITECTURE.md; logout invalidates the server-side session.
 */
@Service
public class AuthService {

    /** Login throttle: max attempts per session window. Demo-grade, documented as such. */
    static final int MAX_ATTEMPTS_PER_WINDOW = 10;
    private static final long WINDOW_MS = 60_000L;

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

        if (!consumeAttempt(email)) {
            throw new BadRequestException("RATE_LIMITED",
                    "Too many attempts. Please wait a minute and try again.");
        }

        try {
            Authentication authentication = authenticationManager.authenticate(
                    new UsernamePasswordAuthenticationToken(email, request.password()));
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

    private boolean consumeAttempt(String key) {
        long now = System.currentTimeMillis();
        WindowState state = attemptCache.get(key, k -> new WindowState(0, now));
        if (now - state.windowStart() > WINDOW_MS) {
            state = new WindowState(0, now);
        }
        if (state.count() >= MAX_ATTEMPTS_PER_WINDOW) {
            return false;
        }
        attemptCache.put(key, new WindowState(state.count() + 1, state.windowStart()));
        return true;
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
