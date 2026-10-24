package com.createanything.stack01;

import static org.assertj.core.api.Assertions.assertThat;

import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.regex.Pattern;

import org.junit.jupiter.api.Test;

/**
 * Contract test: the repository API envelope from docs/PRODUCT_REQUIREMENTS.md
 * section 7 must be present on both success and error responses.
 */
class EnvelopeContractTest {

    private static final Pattern REQUEST_ID = Pattern.compile("^[a-f0-9-]{36}$");

    private record Envelope(boolean success, Object data, Object error, Meta meta) {
        record Meta(String timestamp, Double execution_ms, String request_id) {
        }
    }

    private Envelope parse(String json) throws Exception {
        var mapper = tools.jackson.databind.json.JsonMapper.builder().build();
        return mapper.readValue(json, Envelope.class);
    }

    @Test
    void envelopeSuccessShapeIsDocumentedCompliant() throws Exception {
        // Serialize a representative success envelope via the actual ApiResponse type.
        var apiResponse = com.createanything.stack01.web.ApiResponse.ok(java.util.Map.of("k", "v"));
        String json = tools.jackson.databind.json.JsonMapper.builder().build()
                .writeValueAsString(apiResponse);

        Envelope envelope = parse(json);
        assertThat(envelope.success()).isTrue();
        assertThat(envelope.error()).isNull();
        assertThat(envelope.data()).isNotNull();
        assertThat(envelope.meta().timestamp()).isNotBlank();
        assertThat(REQUEST_ID.matcher(envelope.meta().request_id()).matches()).isTrue();
    }

    @Test
    void envelopeErrorShapeCarriesStableCodeAndSafeMessage() throws Exception {
        var apiResponse = com.createanything.stack01.web.ApiResponse.error(
                org.springframework.http.HttpStatus.BAD_REQUEST, "VALIDATION_ERROR",
                "The request contains invalid fields.",
                java.util.List.of(new com.createanything.stack01.web.ApiResponse.FieldError("email",
                        "INVALID_FORMAT")));
        String json = tools.jackson.databind.json.JsonMapper.builder().build()
                .writeValueAsString(apiResponse);

        Envelope envelope = parse(json);
        assertThat(envelope.success()).isFalse();
        assertThat(envelope.data()).isNull();
        assertThat(envelope.error()).isNotNull();
        String serialized = String.valueOf(envelope.error());
        assertThat(serialized).contains("VALIDATION_ERROR").contains("email");
        assertThat(json).doesNotContain("stackTrace").doesNotContain("sql").doesNotContain("password");
    }

    @Test
    void noSecretLookingValuesInCommittedResources() throws Exception {
        Path resources = Path.of("src", "main", "resources");
        try (var walk = Files.walk(resources)) {
            walk.filter(Files::isRegularFile).forEach(file -> {
                try {
                    String content = Files.readString(file, StandardCharsets.UTF_8);
                    assertThat(content).doesNotContain("super_secret");
                    assertThat(content.toLowerCase()).doesNotContain("changeme123!");
                } catch (Exception e) {
                    throw new RuntimeException(e);
                }
            });
        }
    }
}
