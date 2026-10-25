package com.createanything.stack02.auth;

import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import com.createanything.stack02.web.ApiResponse;
import com.createanything.stack02.web.RequestIdFilter;

import jakarta.servlet.http.HttpServletRequest;
import jakarta.validation.Valid;

/**
 * Pre-session auth endpoints (register / login / logout). All responses are
 * envelope-shaped; the correlation id comes from {@link RequestIdFilter} so
 * header and body always agree.
 */
@RestController
@RequestMapping("/api/v1")
public class AuthController {

    private final AuthService authService;

    public AuthController(AuthService authService) {
        this.authService = authService;
    }

    @PostMapping("/register")
    public ResponseEntity<ApiResponse<AuthService.UserInfo>> register(
            @Valid @RequestBody AuthService.RegisterRequest body, HttpServletRequest request) {
        AuthService.UserInfo user = authService.register(body);
        return ResponseEntity.status(HttpStatus.CREATED)
                .body(ApiResponse.ok(user, RequestIdFilter.currentId(request)));
    }

    @PostMapping("/login")
    public ResponseEntity<ApiResponse<AuthService.UserInfo>> login(
            @Valid @RequestBody AuthService.LoginRequest body, HttpServletRequest request) {
        AuthService.UserInfo user = authService.login(body, request);
        return ResponseEntity.ok(ApiResponse.ok(user, RequestIdFilter.currentId(request)));
    }

    @PostMapping("/logout")
    public ResponseEntity<ApiResponse<java.util.Map<String, Boolean>>> logout(
            HttpServletRequest request) {
        authService.logout(request);
        return ResponseEntity.ok(
                ApiResponse.ok(java.util.Map.of("ok", true), RequestIdFilter.currentId(request)));
    }
}
