package com.createanything.stack01;

import static org.assertj.core.api.Assertions.assertThat;

import java.util.List;
import java.util.Map;

import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.web.server.LocalServerPort;
import org.springframework.boot.resttestclient.TestRestTemplate;
import org.springframework.http.HttpEntity;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpMethod;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.test.context.ActiveProfiles;

/**
 * Full-stack integration tests over a real HTTP server with an H2 test
 * database: register -> login -> protected home -> algorithm run -> logout,
 * plus the security-negative cases from docs/QUALITY_GATES.md Gate D.
 */
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
@org.springframework.boot.resttestclient.autoconfigure.AutoConfigureTestRestTemplate
@ActiveProfiles("test")
class ApiIntegrationTest {

    @LocalServerPort
    int port;

    @Autowired
    TestRestTemplate rest;

    private String url(String path) {
        return "http://127.0.0.1:" + port + path;
    }

    private ResponseEntity<Map<String, Object>> post(String path, Object body,
            HttpHeaders headers) {
        return rest.exchange(url(path), HttpMethod.POST, new HttpEntity<>(body, headers),
                new org.springframework.core.ParameterizedTypeReference<Map<String, Object>>() {
                });
    }

    private ResponseEntity<Map<String, Object>> get(String path, HttpHeaders headers) {
        return rest.exchange(url(path), HttpMethod.GET, new HttpEntity<>(headers),
                new org.springframework.core.ParameterizedTypeReference<Map<String, Object>>() {
                });
    }

    private HttpHeaders jsonHeaders() {
        HttpHeaders headers = new HttpHeaders();
        headers.setContentType(MediaType.APPLICATION_JSON);
        headers.setAccept(List.of(MediaType.APPLICATION_JSON));
        return headers;
    }

    /**
     * Performs login and returns headers carrying the session cookie AND the
     * XSRF-TOKEN echo (required for authenticated state-changing calls since
     * the CSRF exemption was narrowed to register/login).
     */
    private HttpHeaders loginAndBuildHeaders(String email, String password) {
        var login = post("/api/v1/login", Map.of("email", email, "password", password),
                jsonHeaders());
        assertThat(login.getStatusCode()).isEqualTo(HttpStatus.OK);
        HttpHeaders headers = jsonHeaders();
        login.getHeaders().getOrDefault(HttpHeaders.SET_COOKIE, List.of())
                .forEach(c -> headers.add(HttpHeaders.COOKIE, c.split(";")[0]));
        // Echo the double-submit CSRF pair issued alongside the session cookie.
        login.getHeaders().getOrDefault(HttpHeaders.SET_COOKIE, List.of()).stream()
                .filter(c -> c.startsWith("XSRF-TOKEN="))
                .forEach(c -> headers.add("X-XSRF-TOKEN", cookieValue(c)));
        return headers;
    }

    private static String cookieValue(String setCookie) {
        String pair = setCookie.split(";", 2)[0];
        return pair.substring(pair.indexOf('=') + 1);
    }

    @Test
    void registerCreatesAccountAndReturnsEnvelope() {
        var response = post("/api/v1/register",
                Map.of("email", "alice@example.com", "password", "CorrectHorse1"),
                jsonHeaders());

        assertThat(response.getStatusCode()).isEqualTo(HttpStatus.CREATED);
        assertThat(response.getBody()).isNotNull();
        assertThat(response.getBody().get("success")).isEqualTo(true);
        @SuppressWarnings("unchecked")
        Map<String, Object> data = (Map<String, Object>) response.getBody().get("data");
        assertThat(data.get("email")).isEqualTo("alice@example.com");
        assertThat(response.getBody().get("meta")).isNotNull();
    }

    @Test
    void registerRejectsInvalidEmail() {
        var response = post("/api/v1/register",
                Map.of("email", "not-an-email", "password", "CorrectHorse1"), jsonHeaders());

        assertThat(response.getStatusCode()).isEqualTo(HttpStatus.BAD_REQUEST);
        assertThat(response.getBody().get("success")).isEqualTo(false);
        @SuppressWarnings("unchecked")
        Map<String, Object> error = (Map<String, Object>) response.getBody().get("error");
        assertThat(error.get("code")).isEqualTo("VALIDATION_ERROR");
    }

    @Test
    void registerRejectsWeakPassword() {
        var response = post("/api/v1/register", Map.of("email", "weak@example.com", "password", "short"),
                jsonHeaders());

        assertThat(response.getStatusCode()).isEqualTo(HttpStatus.BAD_REQUEST);
        @SuppressWarnings("unchecked")
        Map<String, Object> error = (Map<String, Object>) response.getBody().get("error");
        assertThat(error.get("code")).isEqualTo("VALIDATION_ERROR");
    }

    @Test
    void duplicateEmailIsRejectedWithoutLeakage() {
        post("/api/v1/register", Map.of("email", "dupe@example.com", "password", "CorrectHorse1"),
                jsonHeaders());
        var second = post("/api/v1/register",
                Map.of("email", "dupe@example.com", "password", "CorrectHorse1"), jsonHeaders());

        assertThat(second.getStatusCode()).isEqualTo(HttpStatus.CONFLICT);
        @SuppressWarnings("unchecked")
        Map<String, Object> error = (Map<String, Object>) second.getBody().get("error");
        assertThat(error.get("code")).isEqualTo("EMAIL_TAKEN");
        String body = String.valueOf(second.getBody());
        assertThat(body).doesNotContain("org.").doesNotContain("SQLException").doesNotContain("Exception");
    }

    @Test
    void loginSuccessAndProtectedHome() {
        post("/api/v1/register", Map.of("email", "bob@example.com", "password", "CorrectHorse1"),
                jsonHeaders());

        var login = post("/api/v1/login", Map.of("email", "bob@example.com", "password", "CorrectHorse1"),
                jsonHeaders());
        assertThat(login.getStatusCode()).isEqualTo(HttpStatus.OK);

        List<String> cookies = login.getHeaders().get(HttpHeaders.SET_COOKIE);
        assertThat(cookies).isNotNull();
        HttpHeaders homeHeaders = jsonHeaders();
        cookies.forEach(c -> homeHeaders.add(HttpHeaders.COOKIE, c.split(";")[0]));

        var home = get("/api/v1/home", homeHeaders);
        assertThat(home.getStatusCode()).isEqualTo(HttpStatus.OK);
        @SuppressWarnings("unchecked")
        Map<String, Object> data = (Map<String, Object>) home.getBody().get("data");
        assertThat(data.get("email")).isEqualTo("bob@example.com");
        assertThat(data.get("demo")).isEqualTo(false);
    }

    @Test
    void wrongPasswordGetsGenericError() {
        post("/api/v1/register", Map.of("email", "carol@example.com", "password", "CorrectHorse1"),
                jsonHeaders());

        var bad = post("/api/v1/login", Map.of("email", "carol@example.com", "password", "WrongPass99"),
                jsonHeaders());
        var unknown = post("/api/v1/login", Map.of("email", "ghost@example.com", "password", "WrongPass99"),
                jsonHeaders());

        assertThat(bad.getStatusCode()).isEqualTo(HttpStatus.BAD_REQUEST);
        assertThat(unknown.getStatusCode()).isEqualTo(HttpStatus.BAD_REQUEST);
        // Same code and message: no account enumeration.
        assertThat(bad.getBody().get("error")).isEqualTo(unknown.getBody().get("error"));
    }

    @Test
    void eleventhFailedLoginIsRateLimitedWith429AndRetryAfter() {
        post("/api/v1/register", Map.of("email", "throttle@example.com", "password", "CorrectHorse1"),
                jsonHeaders());

        org.springframework.http.HttpStatusCode last = null;
        Map<String, Object> lastBody = null;
        List<String> retryAfter = null;
        for (int attempt = 1; attempt <= 11; attempt++) {
            var response = post("/api/v1/login",
                    Map.of("email", "throttle@example.com", "password", "WrongPass99"),
                    jsonHeaders());
            last = response.getStatusCode();
            lastBody = response.getBody();
            retryAfter = response.getHeaders().get(HttpHeaders.RETRY_AFTER);
        }

        // Ten failures map to 400 INVALID_CREDENTIALS; the 11th is throttled.
        assertThat(last).isEqualTo(HttpStatus.TOO_MANY_REQUESTS);
        @SuppressWarnings("unchecked")
        Map<String, Object> error = (Map<String, Object>) lastBody.get("error");
        assertThat(error.get("code")).isEqualTo("RATE_LIMITED");
        assertThat(retryAfter).as("429 must advertise Retry-After").isNotNull();

        // Policy (documented): a SUCCESSFUL login clears the failure tally, so
        // the legitimate user recovers immediately after proving credentials.
        var correct = post("/api/v1/login",
                Map.of("email", "throttle@example.com", "password", "CorrectHorse1"), jsonHeaders());
        assertThat(correct.getStatusCode()).isEqualTo(HttpStatus.OK);
    }

    @Test
    void successfulLoginsDoNotConsumeTheThrottleBudget() {
        post("/api/v1/register", Map.of("email", "happy@example.com", "password", "CorrectHorse1"),
                jsonHeaders());

        // 12 successful logins: none may be throttled.
        for (int attempt = 1; attempt <= 12; attempt++) {
            var response = post("/api/v1/login",
                    Map.of("email", "happy@example.com", "password", "CorrectHorse1"),
                    jsonHeaders());
            assertThat(response.getStatusCode()).as("attempt " + attempt)
                    .isEqualTo(HttpStatus.OK);
        }
    }

    @Test
    void protectedEndpointsRejectUnauthenticatedRequests() {
        var home = get("/api/v1/home", jsonHeaders());
        var algo = post("/api/v1/algorithm/run",
                Map.of("algorithm", "fizzbuzz", "input", "15"), jsonHeaders());

        assertThat(home.getStatusCode()).isEqualTo(HttpStatus.UNAUTHORIZED);
        assertThat(algo.getStatusCode()).isEqualTo(HttpStatus.UNAUTHORIZED);
        @SuppressWarnings("unchecked")
        Map<String, Object> error = (Map<String, Object>) home.getBody().get("error");
        assertThat(error.get("code")).isEqualTo("UNAUTHORIZED");
    }

    @Test
    void algorithmRunsFizzBuzzWithMeasuredDurationAndComplexity() {
        post("/api/v1/register", Map.of("email", "dave@example.com", "password", "CorrectHorse1"),
                jsonHeaders());
        HttpHeaders headers = loginAndBuildHeaders("dave@example.com", "CorrectHorse1");

        var run = post("/api/v1/algorithm/run", Map.of("algorithm", "fizzbuzz", "input", "15"),
                headers);
        assertThat(run.getStatusCode()).isEqualTo(HttpStatus.OK);
        @SuppressWarnings("unchecked")
        Map<String, Object> data = (Map<String, Object>) run.getBody().get("data");
        assertThat(data.get("algorithmId")).isEqualTo("fizzbuzz");
        assertThat(String.valueOf(data.get("output"))).contains("FizzBuzz");
        assertThat(data.get("complexity")).isEqualTo("O(n)");
        assertThat((Double) data.get("executionMs")).isGreaterThanOrEqualTo(0.0);
    }

    @Test
    void authenticatedAlgorithmRunWithoutCsrfTokenIsRejected() {
        post("/api/v1/register", Map.of("email", "csrf@example.com", "password", "CorrectHorse1"),
                jsonHeaders());
        var login = post("/api/v1/login", Map.of("email", "csrf@example.com", "password", "CorrectHorse1"),
                jsonHeaders());
        HttpHeaders headers = jsonHeaders();
        login.getHeaders().get(HttpHeaders.SET_COOKIE)
                .forEach(c -> headers.add(HttpHeaders.COOKIE, c.split(";")[0]));
        // Deliberately NO X-XSRF-TOKEN echo.

        var run = post("/api/v1/algorithm/run", Map.of("algorithm", "fizzbuzz", "input", "15"),
                headers);
        // Authenticated but CSRF-silent: 403 FORBIDDEN from the access-denied path.
        assertThat(run.getStatusCode()).isEqualTo(HttpStatus.FORBIDDEN);
    }

    @Test
    void algorithmRejectsUnknownAlgorithmAndOversizedInput() {
        post("/api/v1/register", Map.of("email", "eve@example.com", "password", "CorrectHorse1"),
                jsonHeaders());
        HttpHeaders headers = loginAndBuildHeaders("eve@example.com", "CorrectHorse1");

        var unknown = post("/api/v1/algorithm/run", Map.of("algorithm", "eval-user-code", "input", "x"),
                headers);
        assertThat(unknown.getStatusCode()).isEqualTo(HttpStatus.BAD_REQUEST);
        @SuppressWarnings("unchecked")
        Map<String, Object> unknownError = (Map<String, Object>) unknown.getBody().get("error");
        assertThat(unknownError.get("code")).isEqualTo("UNKNOWN_ALGORITHM");

        var oversized = post("/api/v1/algorithm/run",
                Map.of("algorithm", "reverse", "input", "x".repeat(10_001)), headers);
        assertThat(oversized.getStatusCode()).isEqualTo(HttpStatus.BAD_REQUEST);
        @SuppressWarnings("unchecked")
        Map<String, Object> sizeError = (Map<String, Object>) oversized.getBody().get("error");
        assertThat(sizeError.get("code")).isEqualTo("INPUT_TOO_LARGE");
    }

    @Test
    void logoutInvalidatesSession() {
        post("/api/v1/register", Map.of("email", "frank@example.com", "password", "CorrectHorse1"),
                jsonHeaders());
        var login = post("/api/v1/login", Map.of("email", "frank@example.com", "password", "CorrectHorse1"),
                jsonHeaders());
        HttpHeaders before = jsonHeaders();
        login.getHeaders().get(HttpHeaders.SET_COOKIE)
                .forEach(c -> before.add(HttpHeaders.COOKIE, c.split(";")[0]));
        login.getHeaders().getOrDefault(HttpHeaders.SET_COOKIE, List.of()).stream()
                .filter(c -> c.startsWith("XSRF-TOKEN="))
                .forEach(c -> {
                    String pair = c.split(";", 2)[0];
                    before.add("X-XSRF-TOKEN", pair.substring(pair.indexOf('=') + 1));
                });

        var logout = post("/api/v1/logout", null, before);
        assertThat(logout.getStatusCode()).isEqualTo(HttpStatus.OK);

        var after = get("/api/v1/home", before);
        assertThat(after.getStatusCode()).isEqualTo(HttpStatus.UNAUTHORIZED);
    }
}
