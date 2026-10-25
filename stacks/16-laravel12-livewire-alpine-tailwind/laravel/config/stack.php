<?php

use Illuminate\Support\Env;

// Stack 16 configuration. Small, documented, env-driven.

return [
    // Cache store used by the failed-login rate limiter
    // (App\Services\LoginRateLimiter). Defaults to the same store as the
    // application cache (CACHE_STORE; "database" in the default skeleton,
    // "array" under tests). Override with LOGIN_THROTTLE_STORE (e.g. redis)
    // in production deployments so the counter survives restarts and is
    // shared across workers. An empty LOGIN_THROTTLE_STORE (as shipped in
    // .env.example) means "not set" — treat it as null so the CACHE_STORE
    // default applies.
    'login_throttle_store' => Env::get('LOGIN_THROTTLE_STORE') ?: (Env::get('CACHE_STORE') ?: 'array'),

    // Algorithm workbench input bound (characters). The engine enforces it;
    // this exists so deployments may tighten (never loosen) the bound.
    'algorithm_max_input' => env('ALGORITHM_MAX_INPUT', 10000),
];
