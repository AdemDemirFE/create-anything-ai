<?php

namespace App\Exceptions;

/**
 * A domain-level API exception carrying a stable machine-readable error code
 * and an optional HTTP status + extra response headers (e.g. Retry-After).
 * Rendered into the /api/v1 envelope by bootstrap/app.php.
 */
class ApiException extends \RuntimeException
{
    /**
     * @param  array<int, array{field: string, code: string}>|null  $details
     * @param  array<string, string>  $headers
     */
    public function __construct(
        private readonly string $codeString,
        string $message,
        private readonly int $status = 400,
        private readonly ?array $details = null,
        private readonly array $headers = [],
    ) {
        parent::__construct($message);
    }

    public function getCodeString(): string
    {
        return $this->codeString;
    }

    public function getStatus(): int
    {
        return $this->status;
    }

    /** @return array<int, array{field: string, code: string}>|null */
    public function getDetails(): ?array
    {
        return $this->details;
    }

    /** @return array<string, string> */
    public function getHeaders(): array
    {
        return $this->headers;
    }
}
