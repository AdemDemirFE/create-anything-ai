package com.createanything.stack01.auth;

import org.springframework.http.ResponseEntity;
import org.springframework.validation.annotation.Validated;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import com.createanything.stack01.web.ApiResponse;

import jakarta.servlet.http.HttpServletRequest;
import jakarta.validation.Valid;

/**
 * Public auth endpoints. All responses use the repository API envelope.
 * Successful register/login create an authenticated session cookie
 * (STACK01_SESSION; HttpOnly, SameSite=Lax).
 */
@RestController
@RequestMapping("/api/v1")
@Validated
public class AuthController {

    private final AuthService authService;

    public AuthController(AuthService authService) {
        this.authService = authService;
    }

    @PostMapping("/register")
    public ResponseEntity<ApiResponse<AuthService.UserInfo>> register(
            @Valid @RequestBody AuthService.RegisterRequest request) {
        AuthService.UserInfo user = authService.register(request);
        return ResponseEntity.status(201).body(ApiResponse.ok(user));
    }

    @PostMapping("/login")
    public ResponseEntity<ApiResponse<AuthService.UserInfo>> login(
            @Valid @RequestBody AuthService.LoginRequest request, HttpServletRequest httpRequest) {
        return ResponseEntity.ok(ApiResponse.ok(authService.login(request, httpRequest)));
    }

    @PostMapping("/logout")
    public ResponseEntity<ApiResponse<Void>> logout(HttpServletRequest request) {
        authService.logout(request);
        return ResponseEntity.ok(ApiResponse.ok(null));
    }

    /** Convenience endpoint for clients to fetch the current profile. */
    @GetMapping("/me")
    public ResponseEntity<ApiResponse<AuthService.UserInfo>> me(java.security.Principal principal) {
        return ResponseEntity.ok(ApiResponse.ok(new AuthService.UserInfo(principal.getName())));
    }
}
