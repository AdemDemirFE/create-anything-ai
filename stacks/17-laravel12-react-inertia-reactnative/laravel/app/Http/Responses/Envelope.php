<?php

namespace App\Http\Responses;

use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Validation\ValidationException;

/**
 * The /api/v1 response envelope for this stack:
 *
 *   success: { "ok": true,  "data": {...}, "error": null,    "requestId": "..." }
 *   failure: { "ok": false, "data": null,
 *              "error": { "code": "...", "message": "...", "details": [...] },
 *              "requestId": "..." }
 *
 * It is a deliberate variation of docs/PRODUCT_REQUIREMENTS.md section 7
 * (which uses "success"/"meta.request_id"): the shape is documented here and
 * in ARCHITECTURE.md, shared with BOTH clients — the React web app and the
 * React Native thin shell go through the SAME TypeScript normalizer
 * (../../shared/src/envelope.ts), and the shape is covered by contract
 * tests (EnvelopeContractTest). The requestId is the validated/minted
 * X-Request-Id value from the RequestId middleware, so the header and the
 * body always carry the same correlation id.
 */
final class Envelope
{
    public static function ok(Request $request, mixed $data = null, int $status = 200, array $headers = []): JsonResponse
    {
        return response()->json([
            'ok' => true,
            'data' => $data,
            'error' => null,
            'requestId' => $request->attributes->get('request_id'),
        ], $status)->withHeaders($headers);
    }

    /**
     * @param  array<int, array{field: string, code: string}>|null  $details
     */
    public static function error(
        Request $request,
        string $code,
        string $message,
        int $status,
        ?array $details = null,
        array $headers = [],
    ): JsonResponse {
        $error = [
            'code' => $code,
            'message' => $message,
        ];

        if ($details !== null) {
            $error['details'] = $details;
        }

        return response()->json([
            'ok' => false,
            'data' => null,
            'error' => $error,
            'requestId' => $request->attributes->get('request_id'),
        ], $status)->withHeaders($headers);
    }

    /**
     * Converts Laravel field=>messages validation errors into the flat
     * details list used by the envelope (one entry per field).
     *
     * @param  array<string, mixed>  $errors
     * @return array<int, array{field: string, code: string}>
     */
    public static function detailsFromMessages(array $errors): array
    {
        $details = [];

        foreach ($errors as $field => $messages) {
            $details[] = [
                'field' => (string) $field,
                'code' => 'INVALID',
            ];
        }

        return $details;
    }

    /**
     * Converts a ValidationException into envelope details for the Inertia
     * side is intentionally NOT done: Inertia pages receive Laravel's native
     * flashed errors bag instead (see ARCHITECTURE.md "dual envelope").
     */
    public static function inertiaErrors(ValidationException $exception): array
    {
        return $exception->errors();
    }
}