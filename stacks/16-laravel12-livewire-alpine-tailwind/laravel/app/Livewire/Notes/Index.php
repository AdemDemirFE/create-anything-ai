<?php

namespace App\Livewire\Notes;

use App\Livewire\Concerns\AuthorizesNote;
use Illuminate\Support\Facades\Auth;
use Livewire\Attributes\Computed;
use Livewire\Attributes\Title;
use Livewire\Component;

/**
 * Screen 2b — full-page Livewire notes list (App\Livewire\Notes\Index).
 *
 * Livewire 3 interaction pattern demonstrated here:
 *   - public properties are bound from Blade with wire:model
 *   - public actions (delete) are invoked with wire:click / wire:confirm
 *   - reactivity is server-rendered: every action re-runs render() and only
 *     the component's HTML is swapped in — no SPA, no client API layer.
 */
#[Title('Notes')]
class Index extends Component
{
    use AuthorizesNote;

    /** Bound to the filter input via wire:model.live (debounced). */
    public string $search = '';

    /** @var array<int, int> */
    public array $pendingDeletes = [];

    public function updatingSearch(): void
    {
        // Reset per-row pending-delete state whenever the filter changes so
        // a stale row id can never confirm the wrong deletion.
        $this->reset('pendingDeletes');
    }

    #[Computed]
    public function notes()
    {
        // Ownership scope is server-side (Auth::user()->notes()); the search
        // term is only ever applied as DATA to a parameterized query.
        $query = Auth::user()->notes()->orderByDesc('created_at');

        if ($this->search !== '') {
            // Literal-substring match: escape the LIKE wildcards inside the
            // USER term (% _ \) so a search for "50% off" matches "50% off"
            // instead of every row; the % ... % wrappers stay OUR wildcards.
            // Case-folding remains on the PHP side (mb_strtolower).
            $term = addcslashes(mb_strtolower($this->search), '\\%_');

            // The ESCAPE character is passed as a BINDING, so no PHP-side
            // SQL-quote juggling is needed and the clause is portable
            // across sqlite and PostgreSQL (neither enables a default
            // escape character for LIKE).
            $query->where(function ($q) use ($term): void {
                $q->whereRaw('title LIKE ? ESCAPE ?', ['%'.$term.'%', '\\'])
                    ->orWhereRaw('body LIKE ? ESCAPE ?', ['%'.$term.'%', '\\']);
            });
        }

        return $query->get(['id', 'title', 'body', 'created_at']);
    }

    /** Marks a note for deletion (two-step confirm rendered by the view). */
    public function confirmDelete(int $noteId): void
    {
        $note = $this->findOwnedNote($noteId);

        if ($note !== null) {
            $this->pendingDeletes[] = $note->id;
        }
    }

    public function cancelDelete(int $noteId): void
    {
        $this->pendingDeletes = array_values(
            array_diff($this->pendingDeletes, [$noteId]),
        );
    }

    public function delete(int $noteId): void
    {
        $note = $this->findOwnedNote($noteId);

        if ($note === null) {
            return; // foreign or already-deleted: silently ignore, never leak
        }

        $note->delete();
        $this->pendingDeletes = array_values(
            array_diff($this->pendingDeletes, [$noteId]),
        );

        session()->flash('status', 'Note deleted.');
    }

    public function render()
    {
        return view('livewire.notes.index')
            ->layout('components.app-layout');
    }
}
