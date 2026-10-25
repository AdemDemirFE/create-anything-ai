<?php

namespace App\Http\Controllers;

use App\Http\Responses\Envelope;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class HomeController extends Controller
{
    /**
     * GET /api/v1/home — protected home payload for JSON clients:
     * authenticated profile + safe sample metrics.
     */
    public function home(Request $request): JsonResponse
    {
        return Envelope::ok($request, [
            'user' => $request->user()->only(['id', 'name', 'email']),
            'metrics' => [
                ['label' => 'Notes stored', 'value' => $request->user()->notes()->count()],
                ['label' => 'Member since', 'value' => $request->user()->created_at?->toDateString()],
            ],
            'serverTime' => now()->toIso8601String(),
        ]);
    }
}
