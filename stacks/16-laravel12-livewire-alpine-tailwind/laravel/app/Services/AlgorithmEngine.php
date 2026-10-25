<?php

namespace App\Services;

use App\Exceptions\ApiException;

/**
 * Fixed-catalog "algorithm workbench" engine.
 *
 * Safety contract (docs/PRODUCT_REQUIREMENTS.md section 6):
 *   - The catalog is FIXED code — there is no code-evaluation path anywhere
 *     (no dynamic evaluation or process-execution primitives; pinned by the
 *     source-scan test); user input is DATA only.
 *   - Input is bounded: oversized input is rejected with INPUT_TOO_LARGE
 *     (400), never truncated.
 *   - Output, measured duration (monotonic clock, hrtime) and the static
 *     Big-O note are returned separately so measured time is never confused
 *     with theoretical complexity.
 */
final class AlgorithmEngine
{
    /** Hard input bound in characters (documented in ARCHITECTURE.md). */
    public const MAX_INPUT_LENGTH = 10_000;

    /** @var array<string, array{id: string, label: string, complexity: string, explanation: string}> */
    private const CATALOG = [
        'reverse' => [
            'id' => 'reverse',
            'label' => 'Reverse text',
            'complexity' => 'O(n)',
            'explanation' => 'Walks the input once and emits it back to front; cost grows linearly with input length.',
        ],
        'word-count' => [
            'id' => 'word-count',
            'label' => 'Count words',
            'complexity' => 'O(n)',
            'explanation' => 'Single pass over the input splitting on whitespace; cost grows linearly with input length.',
        ],
        'fizzbuzz' => [
            'id' => 'fizzbuzz',
            'label' => 'FizzBuzz (1..n)',
            'complexity' => 'O(n)',
            'explanation' => 'Iterates 1..n once; every value gets a constant amount of work, so cost is linear in n.',
        ],
        'palindrome' => [
            'id' => 'palindrome',
            'label' => 'Palindrome check',
            'complexity' => 'O(n)',
            'explanation' => 'Two pointers move toward the middle; at most n/2 comparisons, so cost is linear.',
        ],
    ];

    /**
     * @return array<int, array{id: string, label: string, complexity: string, explanation: string}>
     */
    public function catalog(): array
    {
        return array_values(self::CATALOG);
    }

    /**
     * @return array{algorithm: string, input_preview: string, output: string, execution_ms: float, complexity: string, explanation: string}
     */
    public function run(string $id, string $input): array
    {
        if (! isset(self::CATALOG[$id])) {
            throw new ApiException('UNKNOWN_ALGORITHM', 'The requested algorithm does not exist.', 400);
        }

        if (mb_strlen($input) > self::MAX_INPUT_LENGTH) {
            throw new ApiException(
                'INPUT_TOO_LARGE',
                'Input exceeds the maximum of '.self::MAX_INPUT_LENGTH.' characters.',
                400,
            );
        }

        $started = hrtime(true);

        $output = match ($id) {
            'reverse' => strrev($input),
            'word-count' => (string) str_word_count($input),
            'fizzbuzz' => $this->fizzbuzz($this->parseBound($input)),
            'palindrome' => $this->palindrome($input) ? 'true' : 'false',
        };

        // Measured with the monotonic clock; reported in milliseconds with
        // one decimal. This is a MEASUREMENT, never a claim of precision.
        // The (float) cast keeps JSON typing stable when the rounded value
        // would degrade to int-like 0.
        $executionMs = (float) round((hrtime(true) - $started) / 1e6, 1);

        return [
            'algorithm' => $id,
            'input_preview' => mb_substr($input, 0, 120),
            'output' => $output,
            'execution_ms' => round($executionMs, 1),
            'complexity' => self::CATALOG[$id]['complexity'],
            'explanation' => self::CATALOG[$id]['explanation'],
        ];
    }

    private function fizzbuzz(int $n): string
    {
        $parts = [];
        for ($i = 1; $i <= $n; $i++) {
            $parts[] = $i % 15 === 0 ? 'FizzBuzz' : ($i % 3 === 0 ? 'Fizz' : ($i % 5 === 0 ? 'Buzz' : (string) $i));
        }

        return implode(' ', $parts);
    }

    private function palindrome(string $input): bool
    {
        $normalized = mb_strtolower(preg_replace('/[^a-z0-9]/i', '', $input) ?? '');

        return $normalized !== '' && $normalized === strrev($normalized);
    }

    /**
     * Parses the numeric bound for fizzbuzz: digits only, 1..1000.
     */
    private function parseBound(string $input): int
    {
        $trimmed = trim($input);

        if ($trimmed === '' || preg_match('/^\d{1,4}$/', $trimmed) !== 1) {
            throw new ApiException('INVALID_INPUT', 'FizzBuzz expects a whole number between 1 and 1000.', 400);
        }

        $n = (int) $trimmed;

        if ($n < 1 || $n > 1000) {
            throw new ApiException('INVALID_INPUT', 'FizzBuzz expects a whole number between 1 and 1000.', 400);
        }

        return $n;
    }
}
