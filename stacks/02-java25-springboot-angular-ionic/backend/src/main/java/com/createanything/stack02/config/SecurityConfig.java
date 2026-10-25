package com.createanything.stack02.config;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.context.properties.EnableConfigurationProperties;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.http.HttpStatus;
import org.springframework.security.authentication.AnonymousAuthenticationToken;
import org.springframework.security.config.annotation.web.builders.HttpSecurity;
import org.springframework.security.config.annotation.web.configuration.EnableWebSecurity;
import org.springframework.security.config.http.SessionCreationPolicy;
import org.springframework.security.core.Authentication;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.security.crypto.bcrypt.BCryptPasswordEncoder;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.security.web.SecurityFilterChain;
import org.springframework.security.web.csrf.CookieCsrfTokenRepository;
import org.springframework.security.web.csrf.CsrfFilter;
import org.springframework.security.web.csrf.CsrfToken;
import org.springframework.security.web.csrf.CsrfTokenRequestAttributeHandler;
import org.springframework.web.cors.CorsConfiguration;
import org.springframework.web.cors.CorsConfigurationSource;
import org.springframework.web.cors.UrlBasedCorsConfigurationSource;
import org.springframework.web.filter.OncePerRequestFilter;

import com.createanything.stack02.web.ApiResponse;
import com.createanything.stack02.web.RequestIdFilter;

import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;

import java.io.IOException;
import java.util.List;

/**
 * Auth decision (documented in ARCHITECTURE.md):
 *
 * <ul>
 *   <li>Server-side sessions in an opaque HttpOnly, SameSite=Lax cookie,
 *       backed by the servlet container (H2 in dev/test, PostgreSQL in
 *       compose). Sessions are revocable server-side. The Ionic/Capacitor
 *       native shell replays the same cookie after /api/v1/login.</li>
 *   <li>CSRF uses the double-submit cookie pattern (XSRF-TOKEN cookie echoed
 *       as X-XSRF-TOKEN), enforced on every state-changing API endpoint
 *       EXCEPT the pre-session register/login endpoints (documented
 *       trade-off). The token cookie is re-issued on every request by
 *       {@link CsrfCookieFilter}.</li>
 *   <li>Missing/invalid CSRF token maps to 401 when the caller has no session
 *       (authentication is the more fundamental failure) and 403 otherwise.</li>
 *   <li>CORS origins come from {@code app.cors.allowed-origins} (override via
 *       the ALLOWED_ORIGINS env var documented in .env.example). The Angular
 *       dev server origin is the default.</li>
 *   <li>API and web live on SEPARATE prefixes: this backend serves
 *       {@code /api/v1/**} only; the Angular app is served by its own dev
 *       server / static host and never proxied through the API.</li>
 * </ul>
 */
@Configuration
@EnableWebSecurity
@EnableConfigurationProperties(ThrottleProperties.class)
public class SecurityConfig {

    public static final String COOKIE_NAME = "STACK02_SESSION";

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
    public SecurityFilterChain filterChain(HttpSecurity http,
            org.springframework.core.env.Environment environment,
            CorsConfigurationSource corsConfigurationSource) throws Exception {
        CookieCsrfTokenRepository csrfRepository = CookieCsrfTokenRepository.withHttpOnlyFalse();
        csrfRepository.setCookieName("XSRF-TOKEN");
        csrfRepository.setHeaderName("X-XSRF-TOKEN");
        CsrfTokenRequestAttributeHandler csrfHandler = new CsrfTokenRequestAttributeHandler();

        // Profile detection MUST go through Environment: the JVM system property
        // spring.profiles.active is not set when the profile comes from the
        // SPRING_PROFILES_ACTIVE env var or application.yml.
        boolean dev = environment.acceptsProfiles(org.springframework.core.env.Profiles.of("dev"));
        String[] permitted = dev
                ? new String[] { "/api/v1/register", "/api/v1/login", "/api/v1/logout",
                        "/actuator/health", "/h2-console/**" }
                : new String[] { "/api/v1/register", "/api/v1/login", "/api/v1/logout",
                        "/actuator/health" };

        http
                .cors(cors -> cors.configurationSource(corsConfigurationSource))
                .csrf(csrf -> csrf
                        .csrfTokenRepository(csrfRepository)
                        .csrfTokenRequestHandler(csrfHandler)
                        // Only the pre-session auth endpoints are CSRF-exempt; every
                        // other state-changing call must echo XSRF-TOKEN.
                        .ignoringRequestMatchers("/api/v1/register", "/api/v1/login"))
                .addFilterAfter(new CsrfCookieFilter(), CsrfFilter.class)
                .authorizeHttpRequests(auth -> auth
                        .requestMatchers(permitted)
                        .permitAll()
                        .requestMatchers("/api/v1/home", "/api/v1/algorithm/**", "/api/v1/me")
                        .authenticated()
                        .anyRequest()
                        .denyAll())
                .exceptionHandling(ex -> ex
                        .authenticationEntryPoint((request, response, authException) ->
                                writeError(request, response, HttpStatus.UNAUTHORIZED, "UNAUTHORIZED",
                                        "Authentication is required."))
                        .accessDeniedHandler((request, response, accessDeniedException) -> {
                            // CSRF failures land here. An unauthenticated caller (no
                            // session) gets the clean 401 from the entry point; an
                            // authenticated caller missing the CSRF echo gets 403.
                            Authentication authentication =
                                    SecurityContextHolder.getContext().getAuthentication();
                            if (authentication == null
                                    || !authentication.isAuthenticated()
                                    || authentication instanceof AnonymousAuthenticationToken) {
                                writeError(request, response, HttpStatus.UNAUTHORIZED, "UNAUTHORIZED",
                                        "Authentication is required.");
                            } else {
                                writeError(request, response, HttpStatus.FORBIDDEN, "FORBIDDEN",
                                        "You do not have access to this resource.");
                            }
                        }))
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
    public CorsConfigurationSource corsConfigurationSource(
            // Bound from application.yml; override with the ALLOWED_ORIGINS env var
            // (comma-separated). The Angular dev server origin is the default.
            @Value("${app.cors.allowed-origins:http://localhost:4200,http://127.0.0.1:4200}")
            List<String> allowedOrigins) {
        CorsConfiguration config = new CorsConfiguration();
        config.setAllowedOrigins(allowedOrigins);
        config.setAllowedMethods(List.of("GET", "POST", "OPTIONS"));
        config.setAllowedHeaders(List.of("Content-Type", "Accept", "X-XSRF-TOKEN"));
        config.setAllowCredentials(true);
        config.setMaxAge(3600L);
        UrlBasedCorsConfigurationSource source = new UrlBasedCorsConfigurationSource();
        source.registerCorsConfiguration("/api/**", config);
        return source;
    }

    /**
     * Forces the CSRF token to be resolved on every request so the
     * XSRF-TOKEN cookie is always (re)issued — the documented Spring Security
     * pattern for SPA clients. Without it the deferred token would never
     * reach the cookie and browser clients could not echo the header.
     */
    static final class CsrfCookieFilter extends OncePerRequestFilter {

        @Override
        protected void doFilterInternal(HttpServletRequest request, HttpServletResponse response,
                FilterChain filterChain) throws ServletException, IOException {
            CsrfToken token = (CsrfToken) request.getAttribute(CsrfToken.class.getName());
            if (token != null) {
                token.getToken();
            }
            filterChain.doFilter(request, response);
        }
    }

    private void writeError(HttpServletRequest request, HttpServletResponse response,
            HttpStatus status, String code, String message) throws IOException {
        String requestId = RequestIdFilter.currentId(request);
        response.setStatus(status.value());
        response.setContentType("application/json");
        response.setCharacterEncoding("UTF-8");
        response.setHeader(RequestIdFilter.HEADER, requestId);
        response.getWriter().write(
                tools.jackson.databind.json.JsonMapper.builder().build().writeValueAsString(
                        ApiResponse.error(code, message, requestId)));
    }
}
