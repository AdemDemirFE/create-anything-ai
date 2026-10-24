package com.createanything.stack01.web;

import java.util.List;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.MethodArgumentNotValidException;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;
import org.springframework.web.servlet.resource.NoResourceFoundException;

import jakarta.servlet.http.HttpServletRequest;

/**
 * Maps every failure to the repository API envelope with stable error codes.
 * Messages are safe: no stack traces, SQL, or internal infrastructure names.
 * Request id and timestamp come from {@link ApiResponse}; the correlation id is
 * also echoed as the {@code X-Request-Id} response header.
 */
@RestControllerAdvice
public class GlobalExceptionHandler {

    private static final Logger log = LoggerFactory.getLogger(GlobalExceptionHandler.class);

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
        String requestId = request.getHeader("X-Request-Id");
        ApiResponse<Void> body = ApiResponse.error(HttpStatus.TOO_MANY_REQUESTS, ex.getCode(),
                ex.getMessage(), List.of());
        return ResponseEntity.status(HttpStatus.TOO_MANY_REQUESTS)
                .header("X-Request-Id", requestId != null ? requestId : body.meta().request_id())
                // Retry-After advertised in seconds (AuthService.RETRY_AFTER_SECONDS).
                .header("Retry-After", String.valueOf(
                        com.createanything.stack01.auth.AuthService.RETRY_AFTER_SECONDS))
                .body(body);
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
        String requestId = request.getHeader("X-Request-Id");
        ApiResponse<Void> body = ApiResponse.error(status, code, message, details);
        return ResponseEntity.status(status)
                .header("X-Request-Id", requestId != null ? requestId : body.meta().request_id())
                .body(body);
    }
}
