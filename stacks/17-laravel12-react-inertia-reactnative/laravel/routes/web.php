<?php

use App\Http\Controllers\AlgorithmController;
use App\Http\Controllers\Auth\AuthenticatedSessionController;
use App\Http\Controllers\Auth\RegisteredUserController;
use App\Http\Controllers\DashboardController;
use App\Http\Controllers\HomeController;
use App\Http\Controllers\NoteController;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Route;
use Inertia\Inertia;

/*
|--------------------------------------------------------------------------
| Web routes — Inertia pages (server-side routing, SPA feel)
|--------------------------------------------------------------------------
| Screen 1 (welcome / register / login), screen 2 (dashboard + notes list),
| screen 3 (note detail), screen 4 (note form + algorithm workbench).
| Each visit is a real server round-trip; Inertia swaps the React page
| component client-side, giving the SPA feel without a client router or
| API layer.
|
| The JSON API (/api/v1) lives in routes/api.php, NOT here: this file runs
| under the `web` middleware group whose ValidateCsrfToken middleware would
| reject every native-client write with HTTP 419. See routes/api.php.
*/

Route::get('/', function () {
    return Inertia::render('Welcome');
})->name('welcome');

Route::middleware('guest')->group(function () {
    Route::get('/register', [RegisteredUserController::class, 'create'])->name('register');
    Route::post('/register', [RegisteredUserController::class, 'store'])->name('register.store');

    Route::get('/login', [AuthenticatedSessionController::class, 'create'])->name('login');
    Route::post('/login', [AuthenticatedSessionController::class, 'store'])->name('login.store');
});

Route::middleware('auth')->group(function () {
    Route::post('/logout', [AuthenticatedSessionController::class, 'destroy'])->name('logout');

    Route::get('/dashboard', DashboardController::class)->name('dashboard');

    Route::get('/notes', [NoteController::class, 'index'])->name('notes.index');
    Route::get('/notes/create', [NoteController::class, 'create'])->name('notes.create');
    Route::post('/notes', [NoteController::class, 'store'])->name('notes.store');
    Route::get('/notes/{note}', [NoteController::class, 'show'])->name('notes.show');
    Route::get('/notes/{note}/edit', [NoteController::class, 'edit'])->name('notes.edit');
    Route::put('/notes/{note}', [NoteController::class, 'update'])->name('notes.update');
    Route::delete('/notes/{note}', [NoteController::class, 'destroy'])->name('notes.destroy');

    Route::get('/algorithm', [AlgorithmController::class, 'index'])->name('algorithm.index');
    Route::post('/algorithm', [AlgorithmController::class, 'runInertia'])->name('algorithm.run');
});

