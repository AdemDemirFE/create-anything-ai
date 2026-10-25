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
import org.springframework.test.context.ActiveProfiles;

import com.createanything.stack02.web.ApiResponse;

import tools.jackson.databind.JsonNode;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * Envelope contract (docs/PRODUCT_REQUIREMENTS.md section 7), verified over
 * REAL HTTP against a running server: every response â€” success AND error â€”
 * is envelope-shaped with success/data/error/meta, and carries an
 * X-Request-Id header that matches {@code [A-Za-z0-9-]{1,64}}.
 *
 * <p>Correlation policy: a conforming incoming X-Request-Id is ECHOED (same
 * value in header and body meta); a non-conforming one is discarded and
 * replaced by a server-generated id in BOTH places.
 */
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
@org.springframework.boot.resttestclient.autoconfigure.AutoConfigureTestRestTemplate
@ActiveProfiles("test")
class EnvelopeContractTest {

    @Autowired
    private TestRestTemplate restTemplate;

    @org.springframework.boot.test.web.server.LocalServerPort
    private int port;

    private String url(String path) {
        return "http://127.0.0.1:" + port + path;
    }

    @Test
    void healthIsUp() {
        ResponseEntity<String> response = restTemplate.getForEntity(url("/actuator/health"), String.class);
        assertThat(response.getStatusCode()).isEqualTo(HttpStatus.OK);
    }

    @Test
    void errorResponsesAreEnvelopeShapedWithConformingRequestId() {
        ResponseEntity<ApiResponse> response = restTemplate.postForEntity(
                "/api/v1/register",
                body("{\"email\":\"not-an-email\",\"password\":\"x\"}"),
                ApiResponse.class);

        assertThat(response.getStatusCode()).isEqualTo(HttpStatus.BAD_REQUEST);
        ApiResponse<?> envelope = response.getBody();
        assertThat(envelope).isNotNull();
        assertThat(envelope.success()).isFalse();
        assertThat(envelope.data()).isNull();
        assertThat(envelope.error()).isNotNull();
        assertThat(envelope.error().code()).isEqualTo("VALIDATION_ERROR");
        assertThat(envelope.meta()).isNotNull();
        assertThat(envelope.meta().timestamp()).isNotBlank();
        assertThat(envelope.meta().request_id()).isNotBlank();
        assertThat(envelope.meta().request_id()).matches(ApiResponse.REQUEST_ID_PATTERN);

        String headerId = response.getHeaders().getFirst("X-Request-Id");
        assertThat(headerId).isNotNull();
        assertThat(headerId).matches(ApiResponse.REQUEST_ID_PATTERN);
        assertThat(headerId).isEqualTo(envelope.meta().request_id());
    }

    @Test
    void conformingIncomingRequestIdIsEchoedInHeaderAndBody() {
        HttpHeaders headers = new HttpHeaders();
        headers.set("X-Request-Id", "integration-test-request-id-01");
        ResponseEntity<ApiResponse> response = restTemplate.exchange(
                "/api/v1/register",
                HttpMethod.POST,
                new HttpEntity<>(body("{\"email\":\"not-an-email\",\"password\":\"x\"}"), headers),
                ApiResponse.class);

        assertThat(response.getStatusCode()).isEqualTo(HttpStatus.BAD_REQUEST);
        assertThat(response.getHeaders().getFirst("X-Request-Id"))
                .isEqualTo("integration-test-request-id-01");
        assertThat(response.getBody()).isNotNull();
        assertThat(response.getBody().meta().request_id())
                .isEqualTo("integration-test-request-id-01");
    }

    @Test
    void nonConformingIncomingRequestIdIsReplacedByServerGeneratedId() {
        HttpHeaders headers = new HttpHeaders();
        // 65 chars (over the 64 cap) with a disallowed character set.
        headers.set("X-Request-Id", "x".repeat(65));
        ResponseEntity<ApiResponse> response = restTemplate.exchange(
                "/api/v1/register",
                HttpMethod.POST,
                new HttpEntity<>(body("{\"email\":\"not-an-email\",\"password\":\"x\"}"), headers),
                ApiResponse.class);

        assertThat(response.getStatusCode()).isEqualTo(HttpStatus.BAD_REQUEST);
        String headerId = response.getHeaders().getFirst("X-Request-Id");
        assertThat(headerId).isNotNull();
        assertThat(headerId).matches(ApiResponse.REQUEST_ID_PATTERN);
        assertThat(headerId).isNotEqualTo("x".repeat(65));
        assertThat(response.getBody()).isNotNull();
        assertThat(response.getBody().meta().request_id()).isEqualTo(headerId);
    }

    @Test
    void unauthorizedHomeIsEnvelopeShaped() {
        ResponseEntity<String> response = restTemplate.getForEntity(url("/api/v1/home"), String.class);
        assertThat(response.getStatusCode()).isEqualTo(HttpStatus.UNAUTHORIZED);

        JsonNode envelope = parse(response.getBody());
        assertThat(envelope.get("success").asBoolean()).isFalse();
        assertThat(envelope.get("error").get("code").asText()).isEqualTo("UNAUTHORIZED");
        assertThat(envelope.get("meta").get("request_id").asText())
                .matches(ApiResponse.REQUEST_ID_PATTERN);
        assertThat(response.getHeaders().getFirst("X-Request-Id"))
                .matches(ApiResponse.REQUEST_ID_PATTERN);
    }

    private static HttpEntity<String> body(String json) {
        HttpHeaders headers = new HttpHeaders();
        headers.set("Content-Type", "application/json");
        return new HttpEntity<>(json, headers);
    }

    private static JsonNode parse(String json) {
        return tools.jackson.databind.json.JsonMapper.builder().build().readTree(json);
    }
}
