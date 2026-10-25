<?php

use App\Http\Controllers\AlgorithmController;
use App\Http\Controllers\Auth\AuthenticatedSessionController;
use App\Http\Controllers\Auth\RegisteredUserController;
use App\Http\Controllers\HomeController;
use App\Http\Controllers\NoteController;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Route;

/*
|--------------------------------------------------------------------------
| /api/v1 — JSON API (session-cookie authenticated, stack envelope)
|--------------------------------------------------------------------------
| Mounted by bootstrap/app.php with withRouting(api: ..., apiPrefix: 'api/v1'),
| which applies the `api` middleware group (see the group override in
| bootstrap/app.php): session cookie + cache limiter + bindings, and
| DELIBERATELY no ValidateCsrfToken — native clients cannot perform the
| CSRF token dance. Cross-site browser abuse of these POSTs is mitigated
| by SameSite=lax session cookies (cross-site POSTs carry no session cookie)
| and by the failed-login rate limiter. Rationale: ARCHITECTURE.md,
| section "Security decisions".
|
| CSRF-419 LESSON (inherited from Stack 15, applied 1:1): these routes live
| in the dedicated api group — NEVER in routes/web.php. The web group
| carries ValidateCsrfToken, which breaks every native-client write with
| HTTP 419 (verified by the smoke script during runtime verification).
| Regression guard: tests/Feature/ApiMiddlewareWiringTest.php pins that
| these routes run in the api group (throttle:api present, CSRF absent).
*/

Route::get('/health', fn (Request $request) => \App\Http\Responses\Envelope::ok(
    $request,
    ['service' => 'stack-16', 'time' => now()->toIso8601String()],
))->name('api.health');

Route::post('/register', [RegisteredUserController::class, 'store'])->name('api.register');
Route::post('/login', [AuthenticatedSessionController::class, 'store'])->name('api.login');

Route::middleware('auth')->group(function () {
    Route::get('/me', fn (Request $request) => \App\Http\Responses\Envelope::ok(
        $request,
        ['user' => $request->user()->only(['id', 'name', 'email'])],
    ))->name('api.me');

    Route::get('/home', [HomeController::class, 'home'])->name('api.home');
    Route::post('/logout', [AuthenticatedSessionController::class, 'destroy'])->name('api.logout');

    Route::get('/notes', function (Request $request) {
        return \App\Http\Responses\Envelope::ok(
            $request,
            ['notes' => $request->user()->notes()->orderByDesc('created_at')->get(['id', 'title', 'body', 'created_at'])],
        );
    })->name('api.notes.index');

    Route::post('/notes', [NoteController::class, 'store'])->name('api.notes.store');
    Route::get('/notes/{note}', [NoteController::class, 'show'])->name('api.notes.show');
    Route::put('/notes/{note}', [NoteController::class, 'update'])->name('api.notes.update');
    Route::delete('/notes/{note}', [NoteController::class, 'destroy'])->name('api.notes.destroy');

    Route::get('/algorithm', [AlgorithmController::class, 'catalog'])->name('api.algorithm.catalog');
    Route::post('/algorithm/run', [AlgorithmController::class, 'run'])->name('api.algorithm.run');
});
