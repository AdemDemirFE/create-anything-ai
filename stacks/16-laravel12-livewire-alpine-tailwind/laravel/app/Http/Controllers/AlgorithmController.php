<?php

namespace App\Http\Controllers;

use App\Exceptions\ApiException;
use App\Http\Responses\Envelope;
use App\Services\AlgorithmEngine;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/**
 * /api/v1 half of the algorithm workbench (screen 4). The BROWSER
 * workbench is the full-page Livewire component App\Livewire\Workbench;
 * this controller serves the JSON contract only.
 * Fixed catalog only; user input is DATA, never executed code.
 */
class AlgorithmController extends Controller
{
    public function __construct(private readonly AlgorithmEngine $engine) {}

    public function catalog(Request $request): JsonResponse
    {
        return Envelope::ok($request, [
            'algorithms' => $this->engine->catalog(),
            'maxInputLength' => $this->maxInputLength(),
        ]);
    }

    public function run(Request $request): JsonResponse
    {
        $data = $request->validate([
            'algorithmId' => ['required', 'string'],
            'input' => ['required', 'string'],
        ]);

        try {
            $result = $this->engine->run($data['algorithmId'], $data['input']);
        } catch (ApiException $e) {
            // Re-thrown as-is: the envelope renderer maps UNKNOWN_ALGORITHM /
            // INPUT_TOO_LARGE / INVALID_INPUT to their documented codes.
            throw $e;
        }

        return Envelope::ok($request, $result);
    }

    /** Tighten-only env override shared with the Livewire workbench. */
    public static function maxInputLength(): int
    {
        return (int) config('stack.algorithm_max_input', AlgorithmEngine::MAX_INPUT_LENGTH);
    }
}
