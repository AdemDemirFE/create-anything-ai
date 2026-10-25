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
 *
 * Ownership enforcement (review follow-up): lookups are OWNER-SCOPED — a
 * foreign or missing id yields the SAME 404 NOT_FOUND envelope both ways,
 * so a valid id of another user's note is indistinguishable from an
 * invalid id (no existence leak via status-code differential; the previous
 * 403 FORBIDDEN told an attacker the id exists but belongs to someone
 * else). The 404 is rendered by the generic NotFoundHttpException handler
 * in bootstrap/app.php (NOT_FOUND code on /api/v1, standard Laravel 404
 * page on the web surface) — identical to any other unknown resource.
 */
class NoteController extends Controller
{
    public function index(Request $request): Response
    {
        // Bounded list (review follow-up): default 50, max 100 — the page
        // never loads an unbounded table; the cap is tighten-only from the
        // client's perspective (limit above 100 clamps to 100).
        [$page, $limit] = $this->listBounds($request);

        $notes = Auth::user()->notes()
            ->orderByDesc('created_at')
            ->orderByDesc('id')
            ->skip(($page - 1) * $limit)
            ->take($limit)
            ->get(['id', 'title', 'body', 'created_at']);

        return Inertia::render('Notes/Index', [
            'notes' => $notes,
            'page' => $page,
            'limit' => $limit,
        ]);
    }

    /**
     * API list surface (/api/v1/notes): bounded pagination with metadata.
     *
     * ?limit= (1..notes_list_max_limit, default notes_list_default_limit)
     * ?page=  (>= 1, default 1)
     *
     * Response data: { notes, page, limit, total, hasMore }. `total` is the
     * authenticated user's note count (ownership-scoped), `hasMore` says
     * whether another page exists — the RN shell can drive "load more"
     * without guessing.
     */
    public function indexApi(Request $request): JsonResponse
    {
        [$page, $limit] = $this->listBounds($request);

        $user = $request->user();
        $query = $user->notes()->orderByDesc('created_at')->orderByDesc('id');

        $total = (int) $user->notes()->count();
        $notes = $query->skip(($page - 1) * $limit)->take($limit)->get(['id', 'title', 'body', 'created_at']);

        return Envelope::ok($request, [
            'notes' => $notes,
            'page' => $page,
            'limit' => $limit,
            'total' => $total,
            'hasMore' => $page * $limit < $total,
        ]);
    }

    public function show(Request $request, Note $note): Response|JsonResponse
    {
        $note = $this->findOwnedOrFail($request, $note);

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
        $note = $this->findOwnedOrFail($request, $note);

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

    public function update(Request $request, Note $note): RedirectResponse|JsonResponse
    {
        $note = $this->findOwnedOrFail($request, $note);

        $note->update($this->validated($request));

        if ($request->is('api/*')) {
            return Envelope::ok($request, $this->notePayload($note->refresh()));
        }

        return redirect()->route('notes.show', $note)->with('status', 'Note updated.');
    }

    public function destroy(Request $request, Note $note): RedirectResponse|JsonResponse
    {
        $note = $this->findOwnedOrFail($request, $note);

        $note->delete();

        if ($request->is('api/*')) {
            return Envelope::ok($request, ['deleted' => true]);
        }

        return redirect()->route('notes.index')->with('status', 'Note deleted.');
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

    /**
     * Owner-scoped lookup for route-bound models: a foreign id must be
     * indistinguishable from a missing one (404 NOT_FOUND both ways, no
     * 403 existence leak). The ModelNotFoundException renders exactly like
     * a route-model binding miss for an id that does not exist at all.
     */
    private function findOwnedOrFail(Request $request, Note $note): Note
    {
        if ((int) $note->user_id === (int) $request->user()->id) {
            return $note;
        }

        abort(404);
    }

    /**
     * Shared list bounds for the API and web list surfaces.
     *
     * @return array{0: int, 1: int} [page, limit]
     */
    private function listBounds(Request $request): array
    {
        $defaultLimit = (int) config('stack.notes_list_default_limit', 50);
        $maxLimit = (int) config('stack.notes_list_max_limit', 100);

        $limit = (int) $request->query('limit', (string) $defaultLimit);
        if ($limit < 1) {
            $limit = $defaultLimit;
        }
        $limit = min($limit, $maxLimit);

        $page = (int) $request->query('page', '1');
        if ($page < 1) {
            $page = 1;
        }

        return [$page, $limit];
    }

    /** @return array<string, mixed> */
    private function notePayload(Note $note): array
    {
        return [
            'note' => $note->only(['id', 'title', 'body', 'created_at', 'updated_at']),
        ];
    }
}
