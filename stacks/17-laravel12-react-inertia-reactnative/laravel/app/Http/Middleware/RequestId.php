<?php

namespace App\Http\Middleware;

use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

/**
 * Correlation-id middleware for every response.
 *
 * A client-supplied X-Request-Id is accepted ONLY when it matches
 * ^[A-Za-z0-9-]{1,64}$; anything else (too long, spaces, control characters —
 * header-injection / log-forging vectors) is discarded and a fresh opaque id
 * is minted. The validated value is:
 *   - echoed back as the X-Request-Id response header, and
 *   - stored as $request->attributes['request_id'] so the /api/v1 envelope
 *     body can carry the SAME id (asserted by EnvelopeContractTest).
 */
class RequestId
{
    public const HEADER = 'X-Request-Id';

    public const PATTERN = '/^[A-Za-z0-9-]{1,64}$/';

    public function handle(Request $request, Closure $next): Response
    {
        $incoming = $request->headers->get(self::HEADER, '');
        $id = is_string($incoming) && preg_match(self::PATTERN, $incoming) === 1
            ? $incoming
            : bin2hex(random_bytes(16));

        $request->attributes->set('request_id', $id);

        $response = $next($request);

        $response->headers->set(self::HEADER, $id);

        return $response;
    }
}
