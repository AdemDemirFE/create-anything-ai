<?php

namespace App\Http\Controllers;

use App\Exceptions\ApiException;
use App\Services\AlgorithmEngine;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\RedirectResponse;
use Illuminate\Http\Request;
use Inertia\Inertia;
use Inertia\Response;

/**
 * Screen 4 — the algorithm workbench (Inertia page + /api/v1 endpoint).
 * Fixed catalog only; user input is DATA, never executed code.
 */
class AlgorithmController extends Controller
{
    public function __construct(private readonly AlgorithmEngine $engine) {}

    public function index(Request $request): Response
    {
        return Inertia::render('Algorithm/Index', [
            'catalog' => $this->engine->catalog(),
            'maxInputLength' => AlgorithmEngine::MAX_INPUT_LENGTH,
        ]);
    }

    /**
     * Inertia workbench form target: runs the algorithm and re-renders the
     * page with the result as a page prop (errors flow through the standard
     * flashed error bag; INPUT_TOO_LARGE / INVALID_INPUT / UNKNOWN_ALGORITHM
     * are mapped to field errors here so the Vue form displays them).
     */
    public function runInertia(Request $request): RedirectResponse
    {
        $data = $request->validate([
            'algorithmId' => ['required', 'string'],
            'input' => ['required', 'string'],
        ]);

        try {
            $result = $this->engine->run($data['algorithmId'], $data['input']);
        } catch (ApiException $e) {
            $field = in_array($e->getCodeString(), ['UNKNOWN_ALGORITHM'], true)
                ? 'algorithmId'
                : 'input';

            return redirect()
                ->back()
                ->withErrors([$field => $e->getMessage()])
                ->withInput();
        }

        return redirect()->back()->with('result', $result);
    }

    public function catalog(Request $request): JsonResponse
    {
        return \App\Http\Responses\Envelope::ok($request, [
            'algorithms' => $this->engine->catalog(),
            'maxInputLength' => AlgorithmEngine::MAX_INPUT_LENGTH,
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
        } catch (\App\Exceptions\ApiException $e) {
            // Re-thrown as-is: the envelope renderer maps UNKNOWN_ALGORITHM /
            // INPUT_TOO_LARGE / INVALID_INPUT to their documented codes.
            throw $e;
        }

        return \App\Http\Responses\Envelope::ok($request, $result);
    }
}
