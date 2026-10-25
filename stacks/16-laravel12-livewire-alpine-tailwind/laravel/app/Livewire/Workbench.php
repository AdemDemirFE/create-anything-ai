<?php

namespace App\Livewire;

use App\Exceptions\ApiException;
use App\Services\AlgorithmEngine;
use Livewire\Attributes\Locked;
use Livewire\Attributes\Title;
use Livewire\Attributes\Validate;
use Livewire\Component;

/**
 * Screen 4b — full-page Livewire algorithm workbench.
 *
 * Safety contract (mirrors the /api/v1 engine): fixed catalog only, input
 * is DATA, bounded at ALGORITHM_MAX_INPUT (tighten-only), measured duration
 * (monotonic hrtime) kept separate from the static complexity note.
 * Livewire-specific hardening: algorithmId is #[Locked] against the catalog
 * ids chosen client-side; every run re-validates server-side.
 */
#[Title('Algorithm workbench')]
class Workbench extends Component
{
    /** The chosen algorithm id (bounded to catalog values by run()). */
    public string $algorithmId = '';

    /** Bound to the textarea via wire:model; validated on run. */
    #[Validate('required|string')]
    public string $input = '';

    /** @var array{output: string, execution_ms: float, complexity: string, explanation: string}|null */
    #[Locked]
    public ?array $result = null;

    public function mount(): void
    {
        $catalog = app(AlgorithmEngine::class)->catalog();
        $this->algorithmId = $catalog[0]['id'] ?? '';
    }

    /** Fixed catalog, exposed to the Blade view. */
    public function getCatalogProperty(): array
    {
        return app(AlgorithmEngine::class)->catalog();
    }

    public function getMaxInputLengthProperty(): int
    {
        // Single source of truth: the engine resolves + clamps the config.
        return app(AlgorithmEngine::class)->maxInputLength();
    }

    public function run(): void
    {
        $this->result = null;

        $this->validate([
            'algorithmId' => ['required', 'string'],
            'input' => ['required', 'string'],
        ]);

        try {
            $result = app(AlgorithmEngine::class)->run($this->algorithmId, $this->input);
        } catch (ApiException $e) {
            // UNKNOWN_ALGORITHM / INPUT_TOO_LARGE / INVALID_INPUT surface as
            // field errors on the component (never as raw exception text).
            $field = $e->getCodeString() === 'UNKNOWN_ALGORITHM' ? 'algorithmId' : 'input';

            $this->addError($field, $e->getMessage());

            return;
        }

        $this->result = [
            'output' => $result['output'],
            'execution_ms' => $result['execution_ms'],
            'complexity' => $result['complexity'],
            'explanation' => $result['explanation'],
        ];
    }

    public function render()
    {
        return view('livewire.workbench')
            ->layout('components.app-layout');
    }
}
