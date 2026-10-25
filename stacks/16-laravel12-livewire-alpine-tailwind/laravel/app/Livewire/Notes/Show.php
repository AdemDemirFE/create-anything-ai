<?php

namespace App\Livewire\Notes;

use App\Livewire\Concerns\AuthorizesNote;
use App\Models\Note;
use Illuminate\Validation\ValidationException;
use Livewire\Attributes\Title;
use Livewire\Component;

/**
 * Screen 3 — full-page Livewire note detail.
 *
 * Demonstrates an INLINE EDIT action pair over Livewire: editing switches
 * the component into edit mode, save() validates + persists, and ownership
 * is re-checked server-side on every action (findOwnedNote).
 */
#[Title('Note')]
class Show extends Component
{
    use AuthorizesNote;

    public Note $note;

    public bool $editing = false;

    /** Bound in the edit form via wire:model. */
    public string $title = '';

    /** Bound in the edit form via wire:model. */
    public string $body = '';

    public function mount(Note $note): void
    {
        // Route-model binding + explicit ownership re-check: a foreign id
        // 404s instead of leaking existence.
        if ((int) $note->user_id !== (int) auth()->id()) {
            abort(404);
        }

        $this->note = $note;
    }

    public function startEdit(): void
    {
        $this->title = $this->note->title;
        $this->body = $this->note->body ?? '';
        $this->editing = true;
    }

    public function cancelEdit(): void
    {
        $this->editing = false;
        $this->resetErrorBag();
    }

    public function save(): void
    {
        $this->validate([
            'title' => ['required', 'string', 'min:1', 'max:120'],
            'body' => ['nullable', 'string', 'max:5000'],
        ]);

        $this->note->update([
            'title' => $this->title,
            'body' => $this->body === '' ? null : $this->body,
        ]);

        $this->editing = false;

        session()->flash('status', 'Note updated.');
    }

    public function delete(): void
    {
        $this->note->delete();

        $this->redirectRoute('notes.index');
    }

    public function render()
    {
        return view('livewire.notes.show')
            ->layout('components.app-layout');
    }
}
