<?php

namespace App\Services;

use Illuminate\Cache\RateLimiter;

/**
 * Failed-login rate limiter.
 *
 * Policy (mirrors the reference stacks' limiter design):
 *   - Only FAILED login attempts consume budget; a successful login clears
 *     the tally for that identity pair.
 *   - The key is lowercased email + client IP, so an attacker cannot lock a
 *     victim out by hammering their email alone and one IP cannot silently
 *     try many emails without hitting the same counter.
 *   - Fixed window: Retry-After reports the honest remaining seconds.
 *   - Exceeding the limit throws the throttling exception (HTTP 429 +
 *     Retry-After header); the envelope renderer maps it to RATE_LIMITED.
 *
 * Backed by Laravel's RateLimiter (cache store; array in tests, database in
 * local dev) — in-process/demo-grade by design; production should enforce
 * limits at the edge as well (documented in ARCHITECTURE.md).
 */
class LoginRateLimiter
{
    public function __construct(private readonly RateLimiter $limiter) {}

    /** Maximum failed attempts per window before 429. */
    public static function maxAttempts(): int
    {
        return 5;
    }

    /** Window length in seconds (also advertised via Retry-After). */
    public static function decaySeconds(): int
    {
        return 60;
    }

    public function tooManyAttempts(string $email, string $ip): bool
    {
        return $this->limiter->tooManyAttempts($this->key($email, $ip), self::maxAttempts());
    }

    /** Seconds until the next attempt is allowed (>= 1). */
    public function availableIn(string $email, string $ip): int
    {
        return max(1, $this->limiter->availableIn($this->key($email, $ip)));
    }

    public function hit(string $email, string $ip): void
    {
        $this->limiter->hit($this->key($email, $ip), self::decaySeconds());
    }

    public function clear(string $email, string $ip): void
    {
        $this->limiter->clear($this->key($email, $ip));
    }

    private function key(string $email, string $ip): string
    {
        return 'login:'.sha1(mb_strtolower(trim($email)).'|'.$ip);
    }
}
