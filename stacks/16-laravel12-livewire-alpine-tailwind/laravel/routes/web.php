<?php

use App\Http\Controllers\Auth\AuthenticatedSessionController;
use App\Http\Controllers\Auth\RegisteredUserController;
use App\Http\Controllers\DashboardController;
use App\Livewire\Notes\Form as NoteForm;
use App\Livewire\Notes\Index as NotesIndex;
use App\Livewire\Notes\Show as NoteShow;
use App\Livewire\Workbench;
use Illuminate\Support\Facades\Route;

/*
|--------------------------------------------------------------------------
| Web routes — server-rendered Blade + Livewire 3 (NO SPA)
|--------------------------------------------------------------------------
| Screen 1 (welcome / register / login), screen 2 (dashboard + notes list),
| screen 3 (note detail), screen 4 (note form + algorithm workbench).
|
| Everything here runs under the `web` middleware group (sessions + CSRF):
|   - Auth (register/login/logout) and the dashboard are classic Blade
|     forms posted to controllers — plain HTTP round-trips.
|   - Notes list / detail / form and the algorithm workbench are FULL-PAGE
|     Livewire 3 components: interactions (wire:model bindings + actions)
|     travel over Livewire's own endpoints (`/livewire/update`), which are
|     auto-registered by the Livewire service provider INTO the web group
|     and therefore keep CSRF protection. No SPA router, no client-side
|     API layer.
|
| The JSON API (/api/v1) lives in routes/api.php, NOT here: this file runs
| under the `web` middleware group whose ValidateCsrfToken middleware would
| reject every native-client write with HTTP 419. See routes/api.php and
| the CSRF-419 lesson in ARCHITECTURE.md.
*/

Route::get('/', function () {
    return view('welcome');
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

    // Full-page Livewire components (list / detail / form interactions).
    Route::get('/notes', NotesIndex::class)->name('notes.index');
    Route::get('/notes/create', NoteForm::class)->name('notes.create');
    Route::get('/notes/{note}', NoteShow::class)->name('notes.show');
    Route::get('/notes/{note}/edit', NoteForm::class)->name('notes.edit');

    Route::get('/algorithm', Workbench::class)->name('algorithm.index');
});
