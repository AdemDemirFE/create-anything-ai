package com.createanything.stack01.web;

import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;

import org.springframework.http.HttpStatus;

import com.fasterxml.jackson.annotation.JsonInclude;

/**
 * The repository-wide API envelope (docs/PRODUCT_REQUIREMENTS.md section 7).
 *
 * <pre>
 * { "success": true,  "data": {...}, "error": null,
 *   "meta": { "timestamp": "...", "execution_ms": 2.4, "request_id": "..." } }
 * { "success": false, "data": null,
 *   "error": { "code": "...", "message": "...", "details": [ { "field": "...", "code": "..." } ] },
 *   "meta": { ... } }
 * </pre>
 *
 * Rules enforced here: errors carry a stable machine-readable code and a safe
 * message; field-level details are optional; stack traces never leave the
 * process; {@code execution_ms} is only set where measurement is meaningful.
 */
@JsonInclude(JsonInclude.Include.ALWAYS)
public record ApiResponse<T>(boolean success, T data, ErrorBody error, Meta meta) {

    @JsonInclude(JsonInclude.Include.ALWAYS)
    public record ErrorBody(String code, String message, List<FieldError> details) {
        public ErrorBody(String code, String message) {
            this(code, message, List.of());
        }
    }

    public record FieldError(String field, String code) {
    }

    public record Meta(String timestamp, Double execution_ms, String request_id) {
        public static Meta now() {
            return new Meta(Instant.now().toString(), null, UUID.randomUUID().toString());
        }

        public static Meta nowWithElapsed(long startedNanos) {
            double ms = (System.nanoTime() - startedNanos) / 1_000_000.0;
            return new Meta(Instant.now().toString(), Math.round(ms * 10.0) / 10.0,
                    UUID.randomUUID().toString());
        }
    }

    public static <T> ApiResponse<T> ok(T data) {
        return new ApiResponse<>(true, data, null, Meta.now());
    }

    public static <T> ApiResponse<T> okMeasured(T data, long startedNanos) {
        return new ApiResponse<>(true, data, null, Meta.nowWithElapsed(startedNanos));
    }

    public static <T> ApiResponse<T> error(HttpStatus status, String code, String message) {
        return error(status, code, message, List.of());
    }

    public static <T> ApiResponse<T> error(HttpStatus status, String code, String message,
            List<FieldError> details) {
        List<FieldError> safeDetails = details == null ? new ArrayList<>() : details;
        return new ApiResponse<>(false, null, new ErrorBody(code, message, safeDetails), Meta.now());
    }
}
