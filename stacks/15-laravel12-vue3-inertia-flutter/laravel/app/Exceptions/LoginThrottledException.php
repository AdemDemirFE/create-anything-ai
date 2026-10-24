<?php

namespace App\Exceptions;

use App\Services\LoginRateLimiter;

/**
 * Raised by the login controller when the failed-login budget is exhausted.
 * Rendered as 429 + Retry-After + envelope RATE_LIMITED on /api/v1 (see
 * bootstrap/app.php).
 */
class LoginThrottledException extends ApiException
{
    public function __construct(int $retryAfterSeconds)
    {
        parent::__construct(
            codeString: 'RATE_LIMITED',
            message: 'Too many failed login attempts. Please retry later.',
            status: 429,
            headers: ['Retry-After' => (string) max(1, $retryAfterSeconds)],
        );
    }

    public static function for(LoginRateLimiter $limiter, string $email, string $ip): self
    {
        return new self($limiter->availableIn($email, $ip));
    }
}
