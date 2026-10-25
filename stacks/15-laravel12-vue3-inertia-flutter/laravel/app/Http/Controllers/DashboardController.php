<?php

namespace App\Http\Controllers;

use Illuminate\Http\Request;
use Inertia\Inertia;
use Inertia\Response;

class DashboardController extends Controller
{
    public function __invoke(Request $request): Response
    {
        $user = $request->user();

        return Inertia::render('Dashboard', [
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
