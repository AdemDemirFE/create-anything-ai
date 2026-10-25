package com.createanything.stack02.web;

import java.util.LinkedHashMap;
import java.util.Map;

import org.springframework.security.core.Authentication;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import com.createanything.stack02.web.RequestIdFilter;

import jakarta.servlet.http.HttpServletRequest;

/**
 * Screen 3 — Home. Backend authentication is REQUIRED here (enforced in
 * SecurityConfig); the client router checks too, but the server is the
 * authority. Returns the authenticated profile and a few safe sample
 * metrics derived from the authenticated identity only.
 */
@RestController
@RequestMapping("/api/v1")
public class HomeController {

    @GetMapping("/home")
    public ApiResponse<Map<String, Object>> home(HttpServletRequest request) {
        Authentication authentication = SecurityContextHolder.getContext().getAuthentication();
        String email = authentication.getName();

        Map<String, Object> data = new LinkedHashMap<>();
        data.put("user", Map.of("email", email));
        // Sample metrics: safe, derived from the session identity, no PII beyond
        // the email the user logged in with.
        data.put("metrics", Map.of(
                "sessionActive", true,
                "algorithmsAvailable", 4,
                "maxInputLength", com.createanything.stack02.algorithm.AlgorithmEngine.MAX_INPUT_LENGTH));

        return ApiResponse.ok(data, RequestIdFilter.currentId(request));
    }
}
