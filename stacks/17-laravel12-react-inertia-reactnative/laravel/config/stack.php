<?php

// Stack 17 configuration. Small, documented, env-driven.

return [
    // Cache store used by the failed-login rate limiter
    // (App\Services\LoginRateLimiter). Defaults to the same store as the
    // application cache (CACHE_STORE; "database" in the default skeleton,
    // "array" under tests). Override with LOGIN_THROTTLE_STORE (e.g. redis)
    // in production deployments so the counter survives restarts and is
    // shared across workers.
    'login_throttle_store' => env('LOGIN_THROTTLE_STORE') ?: env('CACHE_STORE', 'array'),

    // Algorithm workbench input bound (characters). The engine enforces it;
    // this exists so deployments may tighten (never loosen) the bound.
    'algorithm_max_input' => env('ALGORITHM_MAX_INPUT', 10000),

    // Notes list pagination bounds (review follow-up): the list surface
    // never returns an unbounded table. DEFAULT is what a client gets
    // without ?limit=; MAX is the hard ceiling — a larger ?limit= clamps
    // to MAX (tighten-only from the client's perspective). Deployments may
    // tighten either value via env; zero/negative values fall back to the
    // documented defaults.
    'notes_list_default_limit' => env('NOTES_LIST_DEFAULT_LIMIT', 50),
    'notes_list_max_limit' => env('NOTES_LIST_MAX_LIMIT', 100),

    // Per-IP budget for the UNAUTHENTICATED auth endpoints (register/login)
    // via `throttle:auth-ip` (review follow-up, OPTIONAL hardening): bounds
    // credential stuffing / bulk account creation from a single address IN
    // ADDITION to the strict failed-login limiter (which is keyed on
    // email+IP and only counts failures). 30/min is far beyond human use
    // (the real-HTTP smoke performs ~14 auth POSTs) yet caps scripted
    // floods at ~43k/day/IP; the window is fixed at 60s (Limit::perMinute).
    // Demo-grade by design — production should also enforce limits at the
    // edge (see ARCHITECTURE.md).
    'auth_ip_throttle_limit' => env('AUTH_IP_THROTTLE_LIMIT', 30),
];
