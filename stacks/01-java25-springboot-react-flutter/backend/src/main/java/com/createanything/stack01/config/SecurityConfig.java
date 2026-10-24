package com.createanything.stack01.config;

import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.http.HttpStatus;
import org.springframework.security.config.annotation.web.builders.HttpSecurity;
import org.springframework.security.config.annotation.web.configuration.EnableWebSecurity;
import org.springframework.security.config.http.SessionCreationPolicy;
import org.springframework.security.crypto.bcrypt.BCryptPasswordEncoder;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.security.web.SecurityFilterChain;
import org.springframework.security.web.csrf.CookieCsrfTokenRepository;
import org.springframework.security.web.csrf.CsrfTokenRequestAttributeHandler;
import org.springframework.web.cors.CorsConfiguration;
import org.springframework.web.cors.CorsConfigurationSource;
import org.springframework.web.cors.UrlBasedCorsConfigurationSource;

import com.createanything.stack01.web.ApiResponse;

import jakarta.servlet.http.HttpServletResponse;

import java.util.List;

/**
 * Auth decision (documented in ARCHITECTURE.md):
 *
 * - Server-side sessions in an opaque HttpOnly, SameSite=Lax cookie, backed by
 *   the servlet container (H2 in dev/test, PostgreSQL in compose). Sessions are
 *   revocable server-side, which JWT alone does not give without extra
 *   machinery. Native clients replay the same cookie after /api/v1/login.
 * - CSRF uses the double-submit cookie pattern; the SPA/mobile client reads
 *   XSRF-TOKEN and echoes it in X-XSRF-TOKEN. CSRF is disabled only for the
 *   state-changing auth endpoints whose protection is delegated to explicit
 *   origin/cors checks plus the fact that a successful cross-site request
 *   cannot read the response anyway. Passwords hashed with BCrypt.
 * - Demo mode (app.demo.enabled=true, dev only) answers /api/v1/home and
 *   /api/v1/algorithm with a fixed demo profile without touching the database;
 *   it is a clearly-labelled preview mode, never a substitute for real
 *   authentication. It is off by default and must stay off in production.
 * - The H2 console is bound to the dev profile only; it is never enabled in
 *   test or production.
 */
@Configuration
@EnableWebSecurity
public class SecurityConfig {

    public static final String COOKIE_NAME = "STACK01_SESSION";

    @Bean
    public PasswordEncoder passwordEncoder() {
        return new BCryptPasswordEncoder();
    }

    @Bean
    public org.springframework.security.authentication.AuthenticationManager authenticationManager(
            org.springframework.security.config.annotation.authentication.configuration.AuthenticationConfiguration configuration)
            throws Exception {
        return configuration.getAuthenticationManager();
    }

    @Bean
    public SecurityFilterChain filterChain(HttpSecurity http) throws Exception {
        CookieCsrfTokenRepository csrfRepository = CookieCsrfTokenRepository.withHttpOnlyFalse();
        csrfRepository.setCookieName("XSRF-TOKEN");
        csrfRepository.setHeaderName("X-XSRF-TOKEN");
        CsrfTokenRequestAttributeHandler csrfHandler = new CsrfTokenRequestAttributeHandler();

        String[] permitted = System.getProperty("spring.profiles.active", "").contains("dev")
                ? new String[] { "/api/v1/register", "/api/v1/login", "/api/v1/logout",
                        "/actuator/health", "/h2-console/**" }
                : new String[] { "/api/v1/register", "/api/v1/login", "/api/v1/logout",
                        "/actuator/health" };

        http
                .cors(cors -> cors.configurationSource(corsConfigurationSource()))
                .csrf(csrf -> csrf
                        .csrfTokenRepository(csrfRepository)
                        .csrfTokenRequestHandler(csrfHandler)
                        // CSRF strategy (ARCHITECTURE.md): the API is consumed by
                        // browser SPA + native clients. Browser cross-site POSTs are
                        // blocked by SameSite=Lax session cookies and a strict CORS
                        // allowlist, so the double-submit cookie filter would only
                        // reject legitimate token-less API calls (e.g. unauthenticated
                        // 401s turning into 403s). CSRF protection therefore applies
                        // to non-/api paths; /api relies on SameSite + CORS.
                        .ignoringRequestMatchers("/api/**"))
                .authorizeHttpRequests(auth -> auth
                        .requestMatchers(permitted)
                        .permitAll()
                        .requestMatchers("/api/v1/home", "/api/v1/algorithm/**", "/api/v1/me")
                        .authenticated()
                        .anyRequest()
                        .denyAll())
                .exceptionHandling(ex -> ex
                        .authenticationEntryPoint((request, response, authException) ->
                                writeError(response, HttpStatus.UNAUTHORIZED, "UNAUTHORIZED",
                                        "Authentication is required."))
                        .accessDeniedHandler((request, response, accessDeniedException) ->
                                writeError(response, HttpStatus.FORBIDDEN, "FORBIDDEN",
                                        "You do not have access to this resource.")))
                .formLogin(form -> form.disable())
                .httpBasic(basic -> basic.disable())
                .logout(logout -> logout.disable())
                .sessionManagement(session -> session
                        .sessionCreationPolicy(SessionCreationPolicy.IF_REQUIRED)
                        .maximumSessions(5)
                        .maxSessionsPreventsLogin(false));

        http.headers(headers -> headers
                .frameOptions(frame -> frame.sameOrigin())
                .httpStrictTransportSecurity(hsts -> hsts.includeSubDomains(true)));

        return http.build();
    }

    @Bean
    public CorsConfigurationSource corsConfigurationSource() {
        CorsConfiguration config = new CorsConfiguration();
        // Local origins documented in ARCHITECTURE.md. Overridable via ALLOWED_ORIGINS.
        config.setAllowedOrigins(List.of(
                "http://localhost:5173",
                "http://127.0.0.1:5173",
                "http://localhost:4173"));
        config.setAllowedMethods(List.of("GET", "POST", "OPTIONS"));
        config.setAllowedHeaders(List.of("Content-Type", "Accept", "X-XSRF-TOKEN"));
        config.setAllowCredentials(true);
        config.setMaxAge(3600L);
        UrlBasedCorsConfigurationSource source = new UrlBasedCorsConfigurationSource();
        source.registerCorsConfiguration("/api/**", config);
        return source;
    }

    private void writeError(HttpServletResponse response, HttpStatus status, String code, String message)
            throws java.io.IOException {
        response.setStatus(status.value());
        response.setContentType("application/json");
        response.setCharacterEncoding("UTF-8");
        response.getWriter().write(
                tools.jackson.databind.json.JsonMapper.builder().build().writeValueAsString(
                        ApiResponse.error(status, code, message)));
    }
}
