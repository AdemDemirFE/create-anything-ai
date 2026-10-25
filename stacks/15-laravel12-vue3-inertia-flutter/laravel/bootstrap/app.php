<?php

use App\Exceptions\ApiException;
use App\Http\Middleware\HandleInertiaRequests;
use App\Http\Middleware\RequestId;
use App\Http\Responses\Envelope;
use Illuminate\Auth\AuthenticationException;
use Illuminate\Auth\Access\AuthorizationException;
use Illuminate\Support\Facades\RateLimiter;
use Illuminate\Cookie\Middleware\EncryptCookies;
use Illuminate\Cookie\Middleware\AddQueuedCookiesToResponse;
use Illuminate\Foundation\Application;
use Illuminate\Foundation\Configuration\Exceptions;
use Illuminate\Foundation\Configuration\Middleware;
use Illuminate\Foundation\Http\Middleware\ValidateCsrfToken;
use Illuminate\Http\Request;
use Illuminate\Routing\Middleware\SubstituteBindings;
use Illuminate\Routing\Middleware\ThrottleRequestsException;use Illuminate\Session\Middleware\StartSession;
use Illuminate\Session\TokenMismatchException;
use Illuminate\Validation\ValidationException;
use Symfony\Component\HttpKernel\Exception\NotFoundHttpException;

return Application::configure(basePath: dirname(__DIR__))
    ->withRouting(
        web: __DIR__.'/../routes/web.php',
        api: __DIR__.'/../routes/api.php',
        apiPrefix: 'api/v1',
        commands: __DIR__.'/../routes/console.php',
        health: '/up',
    )
    ->withMiddleware(function (Middleware $middleware) {
        // Correlation id for EVERY response (web, Inertia and JSON):
        // validates a client-supplied X-Request-Id or mints an opaque one,
        // echoes it back as X-Request-Id and stores it on the request so the
        // /api/v1 envelope builder can reuse the same value.
        $middleware->append(RequestId::class);

        $middleware->web(append: HandleInertiaRequests::class);

        // Middleware group for routes/api.php (mounted via withRouting(api:))
        // The /api/v1 surface is session-cookie authenticated (the SAME
        // Laravel session as the Inertia pages, HttpOnly cookie) and
        // therefore needs the cookie + session middleware. It deliberately
        // does NOT include ValidateCsrfToken: native mobile clients cannot
        // perform the CSRF token dance. Cross-site browser abuse of /api/v1
        // POSTs is mitigated by SameSite=lax session cookies (cross-site
        // POSTs carry no session cookie) and by the failed-login rate
        // limiter. Rationale is documented in ARCHITECTURE.md section
        // "Security decisions", and pinned by ApiMiddlewareWiringTest.
        // NOTE: /api/v1 must never be moved back into routes/web.php — the
        // web group's ValidateCsrfToken rejects every native-client write
        // with HTTP 419 (observed by scripts/smoke.mjs during runtime
        // verification).
        $middleware->group('api', [
            EncryptCookies::class,
            AddQueuedCookiesToResponse::class,
            StartSession::class,
            'throttle:api',
            SubstituteBindings::class,
        ]);

        // The `api` group above references the named limiter `throttle:api`;
        // it is registered in AppServiceProvider::boot() (facades are not
        // usable inside this callback — it runs before the container boot).
    })
    ->withExceptions(function (Exceptions $exceptions) {
        // Every /api/v1 response — including failures — uses the stack
        // envelope { ok, data, error, requestId }. Web/Inertia responses keep
        // Laravel's defaults (redirects with flashed errors), which is the
        // "dual envelope" documented in ARCHITECTURE.md.
        $exceptions->shouldRenderJsonWhen(
            fn (Request $request) => $request->is('api/*') || $request->expectsJson(),
        );

        $exceptions->render(function (ApiException $e, Request $request) {
            if ($request->is('api/*')) {
                return Envelope::error(
                    $request,
                    code: $e->getCodeString(),
                    message: $e->getMessage(),
                    status: $e->getStatus(),
                    details: $e->getDetails(),
                    headers: $e->getHeaders(),
                );
            }

            // Web/Inertia surface: status codes map 1:1 (429 stays 429, 403
            // stays 403, ...). LOGIN throttling on the web stays a plain
            // HTTP 429 page — the Vue form surfaces it via the error event.
            return response($e->getMessage(), $e->getStatus())->withHeaders($e->getHeaders());
        });

        $exceptions->render(function (ValidationException $e, Request $request) {
            if ($request->is('api/*')) {
                return Envelope::error(
                    $request,
                    code: 'VALIDATION_ERROR',
                    message: 'The request contains invalid fields.',
                    status: 422,
                    details: Envelope::detailsFromMessages($e->errors()),
                );
            }

            return null;
        });

        $exceptions->render(function (AuthenticationException $e, Request $request) {
            if ($request->is('api/*')) {
                return Envelope::error(
                    $request,
                    code: 'UNAUTHENTICATED',
                    message: 'Authentication is required.',
                    status: 401,
                );
            }

            return null;
        });

        // NOTE: Handler::prepareException() converts AuthorizationException
        // into AccessDeniedHttpException BEFORE render callbacks run, so the
        // 403 case is covered by the HttpException variants below.
        // NOTE: abort(403) produces a generic HttpException(403) (Symfony
        // HttpException is the base for AccessDenied/NotFound/Throttle), so
        // this renderer must run BEFORE the Throwable fallback and must not
        // swallow other 4xx/5xx codes: only status 403 maps to FORBIDDEN,
        // everything else keeps its status text and code.
        $exceptions->render(function (\Symfony\Component\HttpKernel\Exception\HttpException $e, Request $request) {
            if (! $request->is('api/*')) {
                return null;
            }

            return match ($e->getStatusCode()) {
                403 => Envelope::error(
                    $request,
                    code: 'FORBIDDEN',
                    message: 'You are not allowed to perform this action.',
                    status: 403,
                ),
                404 => Envelope::error(
                    $request,
                    code: 'NOT_FOUND',
                    message: 'The requested resource was not found.',
                    status: 404,
                ),
                419 => Envelope::error(
                    $request,
                    code: 'CSRF_TOKEN_MISMATCH',
                    message: 'The request was rejected.',
                    status: 419,
                ),
                default => Envelope::error(
                    $request,
                    code: 'HTTP_'.((string) $e->getStatusCode()),
                    message: 'The request could not be completed.',
                    status: $e->getStatusCode(),
                    headers: method_exists($e, 'getHeaders') ? $e->getHeaders() : [],
                ),
            };
        });

        $exceptions->render(function (ThrottleRequestsException $e, Request $request) {
            if ($request->is('api/*')) {
                return Envelope::error(
                    $request,
                    code: 'RATE_LIMITED',
                    message: 'Too many requests. Please retry later.',
                    status: 429,
                    headers: $e->getHeaders(),
                );
            }

            return null;
        });

        $exceptions->render(function (NotFoundHttpException $e, Request $request) {
            if ($request->is('api/*')) {
                return Envelope::error(
                    $request,
                    code: 'NOT_FOUND',
                    message: 'The requested resource was not found.',
                    status: 404,
                );
            }

            return null;
        });

        $exceptions->render(function (TokenMismatchException $e, Request $request) {
            if ($request->is('api/*')) {
                return Envelope::error(
                    $request,
                    code: 'CSRF_TOKEN_MISMATCH',
                    message: 'The request was rejected.',
                    status: 419,
                );
            }

            return null;
        });

        // Last resort for /api/*: a stable, safe envelope. Never leaks
        // exception messages, stack traces or SQL details.
        $exceptions->render(function (Throwable $e, Request $request) {
            if ($request->is('api/*') && ! $e instanceof ValidationException) {
                report($e); // full detail goes to the log; client sees the generic envelope

                return Envelope::error(
                    $request,
                    code: 'INTERNAL_ERROR',
                    message: 'An unexpected error occurred.',
                    status: 500,
                );
            }

            return null;
        });
    })->create();
