package com.createanything.stack02;

import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.resttestclient.TestRestTemplate;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.web.server.LocalServerPort;
import org.springframework.http.HttpEntity;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpMethod;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;

import com.createanything.stack02.web.ApiResponse;

import org.springframework.test.context.ActiveProfiles;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * Authenticated API flows over REAL HTTP: home (screen 3) and the algorithm
 * workbench (screen 4), including the oversized-input rejection and the
 * unknown-algorithm envelope error.
 *
 * <p>TestRestTemplate does NOT keep cookies across calls, so the session
 * cookie AND the double-submit CSRF pair captured at login are carried
 * explicitly on every authenticated request (same contract a browser or the
 * Ionic WebView fulfils).
 */
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
@org.springframework.boot.resttestclient.autoconfigure.AutoConfigureTestRestTemplate
@ActiveProfiles("test")
class HomeAndAlgorithmIntegrationTest {

    @Autowired
    private TestRestTemplate restTemplate;

    @org.springframework.boot.test.web.server.LocalServerPort
    private int port;

    private String url(String path) {
        return "http://127.0.0.1:" + port + path;
    }

    /** Session headers captured at login (cookie + CSRF echo). */
    private HttpHeaders sessionHeaders;

    @Test
    void homeRequiresAuthenticationAndWorksWithSession() {
        assertThat(restTemplate.getForEntity(url("/api/v1/home"), String.class).getStatusCode())
                .isEqualTo(HttpStatus.UNAUTHORIZED);

        restTemplate.postForEntity(
                url("/api/v1/register"),
                json("{\"email\":\"Summit.Meadow@Example.com\",\"password\":\"Copper Field 39\"}"),
                ApiResponse.class);
        login("summit.meadow@example.com", "Copper Field 39");

        ResponseEntity<String> home = restTemplate.exchange(
                url("/api/v1/home"), HttpMethod.GET, new HttpEntity<>(sessionHeaders), String.class);
        assertThat(home.getStatusCode()).isEqualTo(HttpStatus.OK);
        assertThat(home.getBody()).contains("summit.meadow@example.com");
        assertThat(home.getBody()).contains("metrics");
    }

    @Test
    void workbenchListsCatalogAndRunsAlgorithm() {
        registerAndLogin("Harbor.Panel@Example.com", "Willow Summit 84");

        ResponseEntity<String> catalog = restTemplate.exchange(
                url("/api/v1/algorithm"), HttpMethod.GET, new HttpEntity<>(sessionHeaders), String.class);
        assertThat(catalog.getStatusCode()).isEqualTo(HttpStatus.OK);
        assertThat(catalog.getBody()).contains("reverse");
        assertThat(catalog.getBody()).contains("O(n)");

        ResponseEntity<String> run = restTemplate.exchange(
                url("/api/v1/algorithm?algorithm=reverse"), HttpMethod.POST,
                jsonAuthed("{\"input\":\"meadow lantern\"}"), String.class);
        assertThat(run.getStatusCode()).isEqualTo(HttpStatus.OK);
        assertThat(run.getBody()).contains("nretnal wodaem");
        assertThat(run.getBody()).contains("execution_ms");
        assertThat(run.getBody()).contains("complexity");
    }

    @Test
    void workbenchRejectsUnknownAlgorithmAndOversizedInput() {
        registerAndLogin("Cedar.Orchard@Example.com", "Ribbon Harbor 52");

        ResponseEntity<String> unknown = restTemplate.exchange(
                url("/api/v1/algorithm?algorithm=does-not-exist"), HttpMethod.POST,
                jsonAuthed("{\"input\":\"anything goes here\"}"), String.class);
        assertThat(unknown.getStatusCode()).isEqualTo(HttpStatus.BAD_REQUEST);
        assertThat(unknown.getBody()).contains("UNKNOWN_ALGORITHM");

        String oversized = "river".repeat(2_001); // 10_005 chars > cap
        ResponseEntity<String> tooLarge = restTemplate.exchange(
                url("/api/v1/algorithm?algorithm=reverse"), HttpMethod.POST,
                jsonAuthed("{\"input\":\"" + oversized + "\"}"), String.class);
        // Bean Validation (@Size) rejects before the engine: 400 with envelope.
        assertThat(tooLarge.getStatusCode()).isEqualTo(HttpStatus.BAD_REQUEST);
        assertThat(tooLarge.getBody()).contains("VALIDATION_ERROR");
    }

    private void registerAndLogin(String email, String password) {
        restTemplate.postForEntity(
                url("/api/v1/register"),
                json("{\"email\":\"" + email + "\",\"password\":\"" + password + "\"}"),
                ApiResponse.class);
        login(email.toLowerCase(), password);
    }

    /** Logs in and captures the session cookie + CSRF token for later calls. */
    private void login(String email, String password) {
        ResponseEntity<ApiResponse> loginResponse = restTemplate.postForEntity(
                url("/api/v1/login"),
                json("{\"email\":\"" + email + "\",\"password\":\"" + password + "\"}"),
                ApiResponse.class);
        assertThat(loginResponse.getStatusCode()).isEqualTo(HttpStatus.OK);

        sessionHeaders = new HttpHeaders();
        loginResponse.getHeaders().getOrDefault(HttpHeaders.SET_COOKIE, java.util.List.of())
                .forEach(cookie -> sessionHeaders.add(HttpHeaders.COOKIE, cookie.split(";")[0]));
        loginResponse.getHeaders().getOrDefault(HttpHeaders.SET_COOKIE, java.util.List.of()).stream()
                .filter(cookie -> cookie.startsWith("XSRF-TOKEN="))
                .forEach(cookie -> sessionHeaders.add("X-XSRF-TOKEN", cookieValue(cookie)));
    }

    private static String cookieValue(String setCookie) {
        String pair = setCookie.split(";", 2)[0];
        return pair.substring(pair.indexOf('=') + 1);
    }

    private HttpEntity<String> jsonAuthed(String payload) {
        sessionHeaders.set("Content-Type", "application/json");
        return new HttpEntity<>(payload, sessionHeaders);
    }

    private static HttpEntity<String> json(String payload) {
        HttpHeaders headers = new HttpHeaders();
        headers.set("Content-Type", "application/json");
        return new HttpEntity<>(payload, headers);
    }
}
