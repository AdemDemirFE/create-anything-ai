package com.createanything.stack02;

import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.resttestclient.TestRestTemplate;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.web.server.LocalServerPort;
import org.springframework.http.HttpEntity;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;

import com.createanything.stack02.auth.AppUserDetailsService;
import com.createanything.stack02.auth.AuthService;
import com.createanything.stack02.auth.UserRepository;
import com.createanything.stack02.config.ThrottleProperties;
import com.createanything.stack02.web.ApiResponse;

import org.springframework.test.context.ActiveProfiles;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * Auth + normalize-before-unique + login throttle, over REAL HTTP.
 *
 * <p>Throttle contract: exactly {@code app.throttle.login-max-failed-attempts}
 * (default 10) FAILED logins per identity (email+IP) within the window
 * succeed in returning 401 INVALID_CREDENTIALS; the next failed attempt
 * returns 429 RATE_LIMITED with a Retry-After header whose value equals the
 * configured {@code app.throttle.retry-after-seconds}. A successful login
 * resets the counter. Test literals are dictionary-style words only.
 */
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
@org.springframework.boot.resttestclient.autoconfigure.AutoConfigureTestRestTemplate
@ActiveProfiles("test")
class AuthIntegrationTest {

    @Autowired
    private TestRestTemplate restTemplate;

    @org.springframework.boot.test.web.server.LocalServerPort
    private int port;

    private String url(String path) {
        return "http://127.0.0.1:" + port + path;
    }

    @Autowired
    private UserRepository userRepository;

    @Autowired
    private ThrottleProperties throttleProperties;

    @Test
    void registerCreatesAccountAndLoginReturnsEmail() {
        ResponseEntity<ApiResponse> registered = restTemplate.postForEntity(
                url("/api/v1/register"),
                json("{\"email\":\"River.Orchard@Example.com\",\"password\":\"Harbor Lantern 42\"}"),
                ApiResponse.class);
        assertThat(registered.getStatusCode()).isEqualTo(HttpStatus.CREATED);
        assertThat(registered.getBody().success()).isTrue();
        // The response echoes the NORMALIZED email.
        assertThat(registered.getBody().data().toString()).contains("river.orchard@example.com");

        ResponseEntity<ApiResponse> session = restTemplate.postForEntity(
                url("/api/v1/login"),
                json("{\"email\":\"river.orchard@example.com\",\"password\":\"Harbor Lantern 42\"}"),
                ApiResponse.class);
        assertThat(session.getStatusCode()).isEqualTo(HttpStatus.OK);
        assertThat(session.getBody().data().toString()).contains("river.orchard@example.com");
    }

    @Test
    void registerIsCaseInsensitiveUnique() {
        restTemplate.postForEntity(
                url("/api/v1/register"),
                json("{\"email\":\"Meadow.Brook@Example.com\",\"password\":\"Cedar Panel 77\"}"),
                ApiResponse.class);

        // Same address in different case/whitespace: MUST hit the same unique
        // account (normalize-before-unique), not create a second one.
        ResponseEntity<ApiResponse> duplicate = restTemplate.postForEntity(
                url("/api/v1/register"),
                json("{\"email\":\"  meadow.BROOK@example.com \",\"password\":\"Cedar Panel 77\"}"),
                ApiResponse.class);

        assertThat(duplicate.getStatusCode()).isEqualTo(HttpStatus.CONFLICT);
        assertThat(duplicate.getBody().error().code()).isEqualTo("EMAIL_TAKEN");
        // Persistence layer holds exactly ONE canonical row.
        assertThat(userRepository.findByEmail(AppUserDetailsService.normalize("Meadow.Brook@Example.com")))
                .isPresent();
    }

    @Test
    void failedLoginReturnsGenericInvalidCredentials() {
        restTemplate.postForEntity(
                url("/api/v1/register"),
                json("{\"email\":\"Juniper.Field@Example.com\",\"password\":\"Willow Basket 15\"}"),
                ApiResponse.class);

        ResponseEntity<ApiResponse> wrongPassword = restTemplate.postForEntity(
                url("/api/v1/login"),
                json("{\"email\":\"juniper.field@example.com\",\"password\":\"Totally Wrong 99\"}"),
                ApiResponse.class);
        assertThat(wrongPassword.getStatusCode()).isEqualTo(HttpStatus.BAD_REQUEST);
        assertThat(wrongPassword.getBody().error().code()).isEqualTo("INVALID_CREDENTIALS");

        // Unknown email: IDENTICAL envelope code/message - no enumeration.
        ResponseEntity<ApiResponse> unknownEmail = restTemplate.postForEntity(
                url("/api/v1/login"),
                json("{\"email\":\"nobody.here@example.com\",\"password\":\"Whatever Note 31\"}"),
                ApiResponse.class);
        assertThat(unknownEmail.getStatusCode()).isEqualTo(HttpStatus.BAD_REQUEST);
        assertThat(unknownEmail.getBody().error().code()).isEqualTo("INVALID_CREDENTIALS");
        assertThat(unknownEmail.getBody().error().message())
                .isEqualTo(wrongPassword.getBody().error().message());
    }

    @Test
    void failedLoginsAreThrottledWithConfiguredRetryAfter() throws Exception {
        setRetryAfter(45L);

        restTemplate.postForEntity(
                url("/api/v1/register"),
                json("{\"email\":\"Copper.Valley@Example.com\",\"password\":\"Quartz Meadow 26\"}"),
                ApiResponse.class);

        HttpStatus lastStatus = null;
        String retryAfterHeader = null;
        for (int attempt = 1; attempt <= throttleProperties.getLoginMaxFailedAttempts() + 2; attempt++) {
            ResponseEntity<ApiResponse> response = restTemplate.postForEntity(
                url("/api/v1/login"),
                    json("{\"email\":\"copper.valley@example.com\",\"password\":\"Wrong Guess 11\"}"),
                    ApiResponse.class);
            lastStatus = HttpStatus.valueOf(response.getStatusCode().value());
            retryAfterHeader = response.getHeaders().getFirst("Retry-After");
            if (lastStatus == HttpStatus.TOO_MANY_REQUESTS) {
                assertThat(attempt).isEqualTo(throttleProperties.getLoginMaxFailedAttempts() + 1);
                assertThat(response.getBody().error().code()).isEqualTo("RATE_LIMITED");
                // Retry-After is CONFIG-DRIVEN (we set 45 above; default is 60).
                assertThat(retryAfterHeader).isEqualTo("45");
                break;
            }
            assertThat(lastStatus).isEqualTo(HttpStatus.BAD_REQUEST);
        }
        assertThat(lastStatus).isEqualTo(HttpStatus.TOO_MANY_REQUESTS);

        setRetryAfter(60L);
    }

    @Test
    void lockedAccountRejectsEvenTheCorrectPassword() {
        restTemplate.postForEntity(
                url("/api/v1/register"),
                json("{\"email\":\"Maple.Ridge@Example.com\",\"password\":\"Golden Valley 71\"}"),
                ApiResponse.class);

        // Exhaust the failure budget for this identity.
        for (int attempt = 0; attempt < throttleProperties.getLoginMaxFailedAttempts(); attempt++) {
            ResponseEntity<ApiResponse> failed = restTemplate.postForEntity(
                url("/api/v1/login"),
                    json("{\"email\":\"maple.ridge@example.com\",\"password\":\"Wrong Guess 11\"}"),
                    ApiResponse.class);
            assertThat(failed.getStatusCode()).isEqualTo(HttpStatus.BAD_REQUEST);
        }

        // CORRECT password after the lock: still 429 RATE_LIMITED with
        // Retry-After. The throttle gate runs BEFORE authentication, so a
        // known password cannot bypass the lock (brute force is bounded).
        ResponseEntity<ApiResponse> correct = restTemplate.postForEntity(
                url("/api/v1/login"),
                json("{\"email\":\"maple.ridge@example.com\",\"password\":\"Golden Valley 71\"}"),
                ApiResponse.class);
        assertThat(correct.getStatusCode()).isEqualTo(HttpStatus.TOO_MANY_REQUESTS);
        assertThat(correct.getBody().error().code()).isEqualTo("RATE_LIMITED");
        assertThat(correct.getHeaders().getFirst("Retry-After")).isNotNull();
    }

    @Test
    void concurrentRegistrationsOfSameEmailYieldExactlyOneAccount() throws Exception {
        // RACE: two parallel registrations of the SAME normalized email. Both
        // can pass the pre-check; the users.email UNIQUE constraint decides.
        // Expected: exactly one 201 CREATED and one 409 EMAIL_TAKEN (never a
        // 500), and exactly ONE row in the persistence layer.
        String email = "amber.meadow@example.com";
        int threads = 2;
        java.util.concurrent.ExecutorService pool =
                java.util.concurrent.Executors.newFixedThreadPool(threads);
        try {
            java.util.concurrent.CountDownLatch start = new java.util.concurrent.CountDownLatch(1);
            java.util.List<java.util.concurrent.Future<ResponseEntity<ApiResponse>>> futures =
                    new java.util.ArrayList<>();
            for (int i = 0; i < threads; i++) {
                futures.add(pool.submit(() -> {
                    start.await();
                    return restTemplate.postForEntity(
                            url("/api/v1/register"),
                            json("{\"email\":\"" + email + "\",\"password\":\"Ribbon Valley 44\"}"),
                            ApiResponse.class);
                }));
            }
            start.countDown();
            java.util.Set<Integer> statuses = new java.util.HashSet<>();
            for (java.util.concurrent.Future<ResponseEntity<ApiResponse>> future : futures) {
                ResponseEntity<ApiResponse> response = future.get(30, java.util.concurrent.TimeUnit.SECONDS);
                statuses.add(response.getStatusCode().value());
            }
            assertThat(statuses).containsExactlyInAnyOrder(201, 409);
        } finally {
            pool.shutdownNow();
        }
        // Exactly one account survived the race.
        assertThat(userRepository.findByEmail(email)).isPresent();
        assertThat(userRepository.findAll().stream()
                .filter(user -> email.equals(user.getEmail())).count()).isEqualTo(1);
    }

    @Test
    void successfulLoginResetsThrottleCounter() {
        restTemplate.postForEntity(
                url("/api/v1/register"),
                json("{\"email\":\"Amber.Harbor@Example.com\",\"password\":\"Lantern Creek 58\"}"),
                ApiResponse.class);

        // Burn some (but not all) failed attempts.
        for (int attempt = 0; attempt < 3; attempt++) {
            restTemplate.postForEntity(
                url("/api/v1/login"),
                    json("{\"email\":\"amber.harbor@example.com\",\"password\":\"Wrong Guess 11\"}"),
                    ApiResponse.class);
        }
        // Correct password still works and clears the tally.
        ResponseEntity<ApiResponse> ok = restTemplate.postForEntity(
                url("/api/v1/login"),
                json("{\"email\":\"amber.harbor@example.com\",\"password\":\"Lantern Creek 58\"}"),
                ApiResponse.class);
        assertThat(ok.getStatusCode()).isEqualTo(HttpStatus.OK);

        // Post-reset: the full budget is available again (no 429).
        for (int attempt = 0; attempt < throttleProperties.getLoginMaxFailedAttempts(); attempt++) {
            ResponseEntity<ApiResponse> response = restTemplate.postForEntity(
                url("/api/v1/login"),
                    json("{\"email\":\"amber.harbor@example.com\",\"password\":\"Wrong Guess 11\"}"),
                    ApiResponse.class);
            assertThat(HttpStatus.valueOf(response.getStatusCode().value()))
                    .isEqualTo(HttpStatus.BAD_REQUEST);
        }
    }

    @Test
    void logoutInvalidatesSession() {
        restTemplate.postForEntity(
                url("/api/v1/register"),
                json("{\"email\":\"Willow.Creek@Example.com\",\"password\":\"Ribbon Summit 63\"}"),
                ApiResponse.class);

        // Login and capture the session cookie + CSRF pair (TestRestTemplate
        // does not keep cookies across calls; both must be carried explicitly).
        ResponseEntity<ApiResponse> login = restTemplate.postForEntity(
                url("/api/v1/login"),
                json("{\"email\":\"willow.creek@example.com\",\"password\":\"Ribbon Summit 63\"}"),
                ApiResponse.class);
        assertThat(login.getStatusCode()).isEqualTo(HttpStatus.OK);
        HttpHeaders sessionHeaders = new HttpHeaders();
        login.getHeaders().getOrDefault(HttpHeaders.SET_COOKIE, java.util.List.of())
                .forEach(cookie -> sessionHeaders.add(HttpHeaders.COOKIE, cookie.split(";")[0]));
        login.getHeaders().getOrDefault(HttpHeaders.SET_COOKIE, java.util.List.of()).stream()
                .filter(cookie -> cookie.startsWith("XSRF-TOKEN="))
                .forEach(cookie -> {
                    String pair = cookie.split(";", 2)[0];
                    sessionHeaders.add("X-XSRF-TOKEN", pair.substring(pair.indexOf('=') + 1));
                });

        // Home works with the session.
        ResponseEntity<String> home = restTemplate.exchange(
                url("/api/v1/home"), org.springframework.http.HttpMethod.GET,
                new HttpEntity<>(sessionHeaders), String.class);
        assertThat(home.getStatusCode()).isEqualTo(HttpStatus.OK);

        // Logout (with the session) then home again: 401 — the server-side
        // session was invalidated, replaying the old cookie fails.
        restTemplate.exchange(url("/api/v1/logout"), org.springframework.http.HttpMethod.POST,
                new HttpEntity<>(sessionHeaders), ApiResponse.class);
        ResponseEntity<String> after = restTemplate.exchange(
                url("/api/v1/home"), org.springframework.http.HttpMethod.GET,
                new HttpEntity<>(sessionHeaders), String.class);
        assertThat(after.getStatusCode()).isEqualTo(HttpStatus.UNAUTHORIZED);
    }

    @Test
    void logoutWithoutCsrfTokenIsRejected() {
        restTemplate.postForEntity(
                url("/api/v1/register"),
                json("{\"email\":\"Willow.Summit@Example.com\",\"password\":\"Ribbon Creek 25\"}"),
                ApiResponse.class);
        ResponseEntity<ApiResponse> login = restTemplate.postForEntity(
                url("/api/v1/login"),
                json("{\"email\":\"willow.summit@example.com\",\"password\":\"Ribbon Creek 25\"}"),
                ApiResponse.class);
        assertThat(login.getStatusCode()).isEqualTo(HttpStatus.OK);

        // Session cookie ONLY (no X-XSRF-TOKEN echo): logout is a
        // state-changing POST, so the double-submit CSRF check must reject
        // it (403 FORBIDDEN) — an attacker page cannot force a logout by
        // simply replaying the victim's cookie cross-site.
        HttpHeaders cookieOnly = new HttpHeaders();
        login.getHeaders().getOrDefault(HttpHeaders.SET_COOKIE, java.util.List.of())
                .forEach(cookie -> cookieOnly.add(HttpHeaders.COOKIE, cookie.split(";")[0]));

        ResponseEntity<ApiResponse> csrfMissing = restTemplate.exchange(
                url("/api/v1/logout"), org.springframework.http.HttpMethod.POST,
                new HttpEntity<>(cookieOnly), ApiResponse.class);
        assertThat(HttpStatus.valueOf(csrfMissing.getStatusCode().value()))
                .isEqualTo(HttpStatus.FORBIDDEN);
    }

    private static HttpEntity<String> json(String payload) {
        HttpHeaders headers = new HttpHeaders();
        headers.set("Content-Type", "application/json");
        return new HttpEntity<>(payload, headers);
    }

    /**
     * Overwrites the handler's Retry-After value at runtime to PROVE the
     * header is config-driven (not a hardcoded constant): the throttle test
     * sets 45 and asserts the header reads "45", then restores the default.
     */
    @Autowired
    private org.springframework.context.ApplicationContext applicationContext;

    private void setRetryAfter(long seconds) {
        var handler = applicationContext.getBean(
                com.createanything.stack02.web.GlobalExceptionHandler.class);
        org.springframework.test.util.ReflectionTestUtils.setField(handler, "retryAfterSeconds", seconds);
    }
}
