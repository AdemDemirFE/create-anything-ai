package com.createanything.stack02.web;

import java.time.Instant;
import java.util.List;

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
 * Errors carry a stable machine-readable code and a safe message (no stack
 * traces, SQL, or infrastructure names). The correlation id resolved once per
 * request by {@link RequestIdFilter} flows into {@code meta.request_id} and is
 * echoed as the {@code X-Request-Id} response header — the two never diverge.
 */
@JsonInclude(JsonInclude.Include.ALWAYS)
public record ApiResponse<T>(boolean success, T data, ErrorBody error, Meta meta) {

    /** Allowed incoming X-Request-Id: 1..64 chars of [A-Za-z0-9-]. */
    public static final String REQUEST_ID_PATTERN = "[A-Za-z0-9-]{1,64}";

    @JsonInclude(JsonInclude.Include.ALWAYS)
    public record ErrorBody(String code, String message, List<FieldError> details) {
        public ErrorBody(String code, String message) {
            this(code, message, List.of());
        }
    }

    public record FieldError(String field, String code) {
    }

    public record Meta(String timestamp, Double execution_ms, String request_id) {
        public static Meta now(String requestId) {
            return new Meta(Instant.now().toString(), null, requestId);
        }

        public static Meta nowWithElapsed(long startedNanos, String requestId) {
            double ms = (System.nanoTime() - startedNanos) / 1_000_000.0;
            return new Meta(Instant.now().toString(), Math.round(ms * 10.0) / 10.0, requestId);
        }
    }

    public static <T> ApiResponse<T> ok(T data, String requestId) {
        return new ApiResponse<>(true, data, null, Meta.now(requestId));
    }

    public static <T> ApiResponse<T> okMeasured(T data, long startedNanos, String requestId) {
        return new ApiResponse<>(true, data, null, Meta.nowWithElapsed(startedNanos, requestId));
    }

    public static <T> ApiResponse<T> error(String code, String message, String requestId) {
        return error(code, message, List.of(), requestId);
    }

    public static <T> ApiResponse<T> error(String code, String message, List<FieldError> details,
            String requestId) {
        List<FieldError> safeDetails = details == null ? List.of() : details;
        return new ApiResponse<>(false, null, new ErrorBody(code, message, safeDetails),
                Meta.now(requestId));
    }
}
