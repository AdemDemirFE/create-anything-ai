<?php

namespace App\Http\Controllers;

use Illuminate\View\View;

class DashboardController extends Controller
{
    /**
     * Screen 2 — authenticated home: profile + safe sample metrics + the
     * five most recent notes. Classic server-rendered Blade; the notes
     * interactions themselves live in the Livewire components below it.
     */
    public function __invoke(): View
    {
        $user = auth()->user();

        return view('dashboard', [
            'metrics' => [
                ['label' => 'Notes stored', 'value' => $user->notes()->count()],
                ['label' => 'Member since', 'value' => $user->created_at?->toDateString()],
            ],
            'recentNotes' => $user->notes()
                ->orderByDesc('created_at')
                ->limit(5)
                ->get(['id', 'title', 'created_at']),
        ]);
    }
}
