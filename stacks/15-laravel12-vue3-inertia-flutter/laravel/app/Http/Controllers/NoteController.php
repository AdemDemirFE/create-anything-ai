<?php

namespace App\Http\Controllers;

use App\Http\Responses\Envelope;
use App\Models\Note;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\RedirectResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Auth;
use Inertia\Inertia;
use Inertia\Response;

/**
 * Notes = the stack's concrete "algorithm workbench"-adjacent CRUD surface
 * backing screens 2 (dashboard list), 3 (detail) and 4 (form). Ownership is
 * enforced server-side on every query (user_id scope), never trusted from
 * the client.
 */
class NoteController extends Controller
{
    public function index(): Response
    {
        $notes = Auth::user()->notes()
            ->orderByDesc('created_at')
            ->get(['id', 'title', 'body', 'created_at']);

        return Inertia::render('Notes/Index', [
            'notes' => $notes,
        ]);
    }

    public function show(Request $request, Note $note): Response|JsonResponse
    {
        $this->authorizeOwner($request, $note);

        if ($request->is('api/*')) {
            return Envelope::ok($request, ['note' => $note->only(['id', 'title', 'body', 'created_at', 'updated_at'])]);
        }

        return Inertia::render('Notes/Show', [
            'note' => $note->only(['id', 'title', 'body', 'created_at', 'updated_at']),
        ]);
    }

    public function create(): Response
    {
        return Inertia::render('Notes/Form', ['mode' => 'create', 'note' => null]);
    }

    public function edit(Request $request, Note $note): Response
    {
        $this->authorizeOwner($request, $note);

        return Inertia::render('Notes/Form', [
            'mode' => 'edit',
            'note' => $note->only(['id', 'title', 'body']),
        ]);
    }

    public function store(Request $request): RedirectResponse|JsonResponse
    {
        $data = $this->validated($request);

        $note = $request->user()->notes()->create($data);

        if ($request->is('api/*')) {
            return Envelope::ok($request, $this->notePayload($note), 201);
        }

        return redirect()->route('notes.show', $note)->with('status', 'Note created.');
    }

    public function showApi(Request $request, Note $note): JsonResponse
    {
        $this->authorizeOwner($request, $note);

        return Envelope::ok($request, ['note' => $note->only(['id', 'title', 'body', 'created_at', 'updated_at'])]);
    }

    public function update(Request $request, Note $note): RedirectResponse|JsonResponse
    {
        $this->authorizeOwner($request, $note);

        $note->update($this->validated($request));

        if ($request->is('api/*')) {
            return Envelope::ok($request, $this->notePayload($note->refresh()));
        }

        return redirect()->route('notes.show', $note)->with('status', 'Note updated.');
    }

    public function destroy(Request $request, Note $note): RedirectResponse|JsonResponse
    {
        $this->authorizeOwner($request, $note);

        $note->delete();

        if ($request->is('api/*')) {
            return Envelope::ok($request, ['deleted' => true]);
        }

        return redirect()->route('notes.index')->with('status', 'Note deleted.');
    }

    /**
     * API surface for the detail screen: { note: {...} } envelope data.
     */
    public function showJson(Request $request, Note $note): JsonResponse
    {
        return $this->showApi($request, $note);
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
