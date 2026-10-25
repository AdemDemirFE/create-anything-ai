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

    // Algorithm workbench input bound (characters). The ENGINE is the single
    // source of truth: it resolves this value (tighten-only — a deployment
    // may lower it, never raise it above AlgorithmEngine::ABSOLUTE_MAX_INPUT_LENGTH;
    // invalid values fall back to the MAX_INPUT_LENGTH default), enforces it
    // in run(), and the /api/v1 catalog + Livewire workbench render the same
    // engine-resolved number.
    'algorithm_max_input' => env('ALGORITHM_MAX_INPUT', 10000),
];
