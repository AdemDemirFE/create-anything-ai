package com.createanything.stack01.web;

import java.security.Principal;
import java.time.OffsetDateTime;
import java.util.List;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/**
 * Protected home endpoint (four-screen journey C). Requires an authenticated
 * session; returns the profile and a small set of deterministic sample metrics.
 */
@RestController
@RequestMapping("/api/v1")
public class HomeController {

    private final boolean demoEnabled;

    public HomeController(@Value("${app.demo.enabled:false}") boolean demoEnabled) {
        this.demoEnabled = demoEnabled;
    }

    public record HomePayload(String email, boolean demo, List<Metric> metrics,
            OffsetDateTime serverTime) {
    }

    public record Metric(String label, String value, String unit) {
    }

    @GetMapping("/home")
    public ApiResponse<HomePayload> home(Principal principal) {
        String email = principal != null ? principal.getName() : null;
        List<Metric> metrics = List.of(
                new Metric("Active projects", "3", "count"),
                new Metric("Algorithms run", "17", "count"),
                new Metric("Uptime this week", "42", "hours"));
        return ApiResponse.ok(new HomePayload(email, demoEnabled, metrics, OffsetDateTime.now()));
    }
}
