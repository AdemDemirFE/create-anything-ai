<?php

namespace App\Livewire\Notes;

use App\Livewire\Concerns\AuthorizesNote;
use App\Models\Note;
use Livewire\Attributes\Locked;
use Livewire\Attributes\Title;
use Livewire\Attributes\Validate;
use Livewire\Component;

/**
 * Screen 4a — full-page Livewire note form (create AND edit).
 *
 * Demonstrates Livewire 3 attribute validation: #[Validate] properties are
 * re-validated server-side on every action, wire:model.live gives live
 * feedback, and the character counter is a plain derived property (no
 * client JS needed).
 */
#[Title('Note form')]
class Form extends Component
{
    use AuthorizesNote;

    /** Edit mode only; locked so the client can never forge another id. */
    #[Locked]
    public ?int $noteId = null;

    #[Validate('required|string|min:1|max:120')]
    public string $title = '';

    #[Validate('nullable|string|max:5000')]
    public string $body = '';

    public function mount(?Note $note = null): void
    {
        if ($note !== null && $note->exists) {
            if ((int) $note->user_id !== (int) auth()->id()) {
                abort(404);
            }

            $this->noteId = $note->id;
            $this->title = $note->title;
            $this->body = $note->body ?? '';
        }
    }

    public function save(): void
    {
        $validated = $this->validate();

        if ($this->noteId !== null) {
            $note = $this->findOwnedNoteOrFail($this->noteId);
            $note->update([
                'title' => $validated['title'],
                'body' => $validated['body'] === '' ? null : $validated['body'],
            ]);

            session()->flash('status', 'Note updated.');

            $this->redirectRoute('notes.show', $note);

            return;
        }

        $note = auth()->user()->notes()->create([
            'title' => $validated['title'],
            'body' => $validated['body'] === '' ? null : $validated['body'],
        ]);

        session()->flash('status', 'Note created.');

        $this->redirectRoute('notes.show', $note);
    }

    public function cancel(): void
    {
        if ($this->noteId !== null) {
            $this->redirectRoute('notes.show', $this->noteId);

            return;
        }

        $this->redirectRoute('notes.index');
    }

    /** Derived property used by the view for the live character counter. */
    public function getBodyLengthProperty(): int
    {
        return mb_strlen($this->body);
    }

    public function render()
    {
        return view('livewire.notes.form')
            ->layout('components.app-layout');
    }
}
