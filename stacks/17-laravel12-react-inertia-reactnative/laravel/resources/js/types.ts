/**
 * Shared Inertia page-prop types for the React pages.
 *
 * This is the "page-prop envelope" half of the dual envelope (see
 * ARCHITECTURE.md): Inertia pages receive server-rendered props, while
 * /api/v1 speaks the { ok, data, error, requestId } JSON envelope consumed
 * through ../../shared (used by direct fetches and the RN shell).
 *
 * NOTE: the Inertia pages intentionally do NOT import the shared ApiClient
 * for their form flows — they use Inertia's useForm, which speaks Laravel's
 * redirected error-bag dialect over full page visits. The shared client is
 * the contract surface for the JSON API side (and the RN shell).
 */

export interface AuthUser {
    id: number;
    name: string;
    email: string;
}

export interface PageProps {
    // Shared props from app/Http/Middleware/HandleInertiaRequests.php:
    auth: { user: AuthUser | null };
    flash: { status: string | null; result: unknown | null };
    // Per-page props vary; pages declare their own beyond these two.
    [key: string]: unknown;
}

export interface Metric {
    label: string;
    value: string | number;
}

export interface NoteDto {
    id: number;
    title: string;
    body: string | null;
    created_at?: string;
    updated_at?: string;
}

export interface AlgorithmInfo {
    id: string;
    label: string;
    complexity: string;
    explanation: string;
}

export interface AlgorithmRunResult {
    algorithm: string;
    input_preview: string;
    output: string;
    execution_ms: number;
    complexity: string;
    explanation: string;
}
