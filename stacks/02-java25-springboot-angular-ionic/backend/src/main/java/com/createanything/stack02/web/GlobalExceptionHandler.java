package com.createanything.stack02.web;

import java.util.List;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpStatus;import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.MethodArgumentNotValidException;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;
import org.springframework.web.servlet.resource.NoResourceFoundException;

import jakarta.servlet.http.HttpServletRequest;

/**
 * Maps every failure to the repository API envelope with stable error codes.
 * Messages are safe: no stack traces, SQL, or internal infrastructure names.
 *
 * <p>Correlation: every response carries {@code X-Request-Id}. An incoming id
 * matching {@link ApiResponse#REQUEST_ID_PATTERN} is echoed; an absent or
 * non-conforming id is replaced by the server-generated id from the envelope
 * meta (client input is validated before reuse, never trusted verbatim).
 *
 * <p>Throttle responses also carry {@code Retry-After} in seconds, sourced
 * from {@code app.throttle.retry-after-seconds} (config-driven; the handler
 * does not hardcode the value).
 */
@RestControllerAdvice
public class GlobalExceptionHandler {

    private static final Logger log = LoggerFactory.getLogger(GlobalExceptionHandler.class);

    /** Retry-After seconds for 429s; bound from app.throttle.retry-after-seconds. */
    @Value("${app.throttle.retry-after-seconds}")
    private long retryAfterSeconds;

    @ExceptionHandler(MethodArgumentNotValidException.class)
    public ResponseEntity<ApiResponse<Void>> onValidation(MethodArgumentNotValidException ex,
            HttpServletRequest request) {
        List<ApiResponse.FieldError> details = ex.getBindingResult().getFieldErrors().stream()
                .map(f -> new ApiResponse.FieldError(f.getField(),
                        f.getDefaultMessage() == null ? "INVALID" : f.getDefaultMessage()))
                .toList();
        return respond(HttpStatus.BAD_REQUEST, "VALIDATION_ERROR",
                "The request contains invalid fields.", details, request);
    }

    @ExceptionHandler(AlreadyExistsException.class)
    public ResponseEntity<ApiResponse<Void>> onAlreadyExists(AlreadyExistsException ex,
            HttpServletRequest request) {
        return respond(HttpStatus.CONFLICT, ex.getCode(), ex.getMessage(), List.of(), request);
    }

    @ExceptionHandler(BadRequestException.class)
    public ResponseEntity<ApiResponse<Void>> onBadRequest(BadRequestException ex,
            HttpServletRequest request) {
        return respond(HttpStatus.BAD_REQUEST, ex.getCode(), ex.getMessage(), List.of(), request);
    }

    @ExceptionHandler(RateLimitedException.class)
    public ResponseEntity<ApiResponse<Void>> onRateLimited(RateLimitedException ex,
            HttpServletRequest request) {
        String requestId = RequestIdFilter.currentId(request);
        ApiResponse<Void> body = ApiResponse.error("RATE_LIMITED", ex.getMessage(), requestId);
        return ResponseEntity.status(HttpStatus.TOO_MANY_REQUESTS)
                .header(RequestIdFilter.HEADER, requestId)
                // Config-driven (app.throttle.retry-after-seconds), not hardcoded.
                .header("Retry-After", String.valueOf(retryAfterSeconds))
                .body(body);
    }

    @ExceptionHandler(com.createanything.stack02.algorithm.InputTooLargeException.class)
    public ResponseEntity<ApiResponse<Void>> onInputTooLarge(
            com.createanything.stack02.algorithm.InputTooLargeException ex,
            HttpServletRequest request) {
        // Defense in depth: the bean-validation @Size rejects oversized input
        // at the controller; this maps the engine-level guard (413) too.
        return respond(HttpStatus.PAYLOAD_TOO_LARGE, "INPUT_TOO_LARGE", ex.getMessage(),
                List.of(), request);
    }

    @ExceptionHandler(IllegalArgumentException.class)
    public ResponseEntity<ApiResponse<Void>> onIllegalArgument(IllegalArgumentException ex,
            HttpServletRequest request) {
        return respond(HttpStatus.BAD_REQUEST, "VALIDATION_ERROR", ex.getMessage(), List.of(), request);
    }

    @ExceptionHandler(NoResourceFoundException.class)
    public ResponseEntity<ApiResponse<Void>> onNotFound(NoResourceFoundException ex,
            HttpServletRequest request) {
        return respond(HttpStatus.NOT_FOUND, "NOT_FOUND", "The requested resource was not found.",
                List.of(), request);
    }

    @ExceptionHandler(org.springframework.security.access.AccessDeniedException.class)
    public ResponseEntity<ApiResponse<Void>> onAccessDenied(
            org.springframework.security.access.AccessDeniedException ex, HttpServletRequest request) {
        return respond(HttpStatus.FORBIDDEN, "FORBIDDEN", "You do not have access to this resource.",
                List.of(), request);
    }

    @ExceptionHandler(Exception.class)
    public ResponseEntity<ApiResponse<Void>> onUnexpected(Exception ex, HttpServletRequest request) {
        // Logged server-side with full detail; the client only sees a generic message.
        log.error("Unhandled exception on {} {}", request.getMethod(), request.getRequestURI(), ex);
        return respond(HttpStatus.INTERNAL_SERVER_ERROR, "INTERNAL_ERROR",
                "An unexpected error occurred. Please try again later.", List.of(), request);
    }

    private ResponseEntity<ApiResponse<Void>> respond(HttpStatus status, String code, String message,
            List<ApiResponse.FieldError> details, HttpServletRequest request) {
        String requestId = RequestIdFilter.currentId(request);
        ApiResponse<Void> body = ApiResponse.error(code, message, details, requestId);
        return ResponseEntity.status(status)
                .header(RequestIdFilter.HEADER, requestId)
                .body(body);
    }
}
