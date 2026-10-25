<?php

namespace App\Http\Controllers;

use App\Http\Responses\Envelope;
use App\Models\Note;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/**
 * JSON-only notes controller backing /api/v1 (native/JSON clients).
 *
 * The BROWSER notes experience is served by the full-page Livewire
 * components in App\Livewire\Notes (list / detail / form with wire:model +
 * actions) — this controller exists so the /api/v1 contract mirrors the
 * other stacks' JSON surface. Ownership is enforced server-side on every
 * query (user_id scope), never trusted from the client.
 */
class NoteController extends Controller
{
    public function store(Request $request): JsonResponse
    {
        $data = $this->validated($request);

        $note = $request->user()->notes()->create($data);

        return Envelope::ok($request, $this->notePayload($note), 201);
    }

    public function show(Request $request, Note $note): JsonResponse
    {
        $this->authorizeOwner($request, $note);

        return Envelope::ok($request, $this->notePayload($note));
    }

    public function update(Request $request, Note $note): JsonResponse
    {
        $this->authorizeOwner($request, $note);

        $note->update($this->validated($request));

        return Envelope::ok($request, $this->notePayload($note->refresh()));
    }

    public function destroy(Request $request, Note $note): JsonResponse
    {
        $this->authorizeOwner($request, $note);

        $note->delete();

        return Envelope::ok($request, ['deleted' => true]);
    }

    /**
     * Bounded input (title <= 120 chars, body <= 5,000 chars) per the
     * four-screen contract: reject oversized payloads, never truncate.
     *
     * @return array{title: string, body: string|null}
     */
    private function validated(Request $request): array
    {
        return $request->validate([
            'title' => ['required', 'string', 'min:1', 'max:120'],
            'body' => ['nullable', 'string', 'max:5000'],
        ]);
    }

    private function authorizeOwner(Request $request, Note $note): void
    {
        if ((int) $note->user_id !== (int) $request->user()->id) {
            abort(403, 'This note belongs to another user.');
        }
    }

    /** @return array<string, mixed> */
    private function notePayload(Note $note): array
    {
        return [
            'note' => $note->only(['id', 'title', 'body', 'created_at', 'updated_at']),
        ];
    }
}
