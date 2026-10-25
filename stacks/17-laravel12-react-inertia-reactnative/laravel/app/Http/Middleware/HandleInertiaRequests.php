<?php

namespace App\Http\Middleware;

use Illuminate\Http\Request;
use Inertia\Middleware;

/**
 * Shares the Inertia page-prop envelope with every Inertia page:
 *
 *   auth: { user: { id, name, email } | null }
 *   flash: { status: string | null }   (e.g. "Logged out.")
 *
 * This is the "page-prop envelope" half of the stack's dual envelope design
 * (ARCHITECTURE.md): Inertia pages receive server-rendered props shaped for
 * each page (rendered by React components), while /api/v1 returns the
 * { ok, data, error, requestId } JSON envelope consumed through the shared
 * TypeScript client (../../shared). The two contracts are documented side
 * by side so both the web app and the React Native thin shell speak to one
 * coherent backend.
 */
class HandleInertiaRequests extends Middleware
{
    /** @var array<string, mixed> */
    protected $rootView = 'app';

    public function share(Request $request): array
    {
        return [
            ...parent::share($request),
            'auth' => [
                'user' => $request->user()
                    ? $request->user()->only(['id', 'name', 'email'])
                    : null,
            ],
            'flash' => [
                'status' => fn () => $request->session()->get('status'),
                'result' => fn () => $request->session()->get('result'),
            ],
        ];
    }
}
