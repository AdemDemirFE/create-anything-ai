/**
 * React page tests for the four-screen contract.
 *
 * The Inertia pages are exercised with mocked usePage/useForm so the tests
 * assert page BEHAVIOR (what renders for which props, error mapping,
 * logout wiring) without a running Laravel backend. The wire format these
 * pages ultimately speak is verified end-to-end by the PHPUnit suite and
 * the real-HTTP smoke script.
 */
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { useState, type ReactElement } from 'react';

// --- Inertia mocks -----------------------------------------------------------
const routeMock = vi.fn(
    (name: string, params?: unknown) =>
        `/${name.replace(/\./g, '/')}${params !== undefined ? `/${String(params)}` : ''}`,
);
const postMock = vi.fn();
const deleteMock = vi.fn();
const putMock = vi.fn();

let pageProps: Record<string, unknown> = {
    auth: { user: null },
    flash: { status: null, result: null },
};
let formErrors: Record<string, string> = {};

vi.mock('@inertiajs/react', () => ({
    Head: ({ title }: { title: string }) => <title>{title}</title>,
    router: {
        post: (...args: unknown[]) => postMock(...args),
        delete: (...args: unknown[]) => deleteMock(...args),
    },
    usePage: () => ({ props: pageProps }),
    // Backed by real React state: controlled inputs must keep their values
    // between renders, otherwise jsdom's HTML5 constraint validation
    // (`required` attributes) blocks the submit event entirely.
    useForm: (initial: Record<string, unknown>) => {
        const [data, setDataState] = useState(initial);
        return {
            data,
            setData: (key: string, value: unknown) =>
                setDataState((current: Record<string, unknown>) => ({ ...current, [key]: value })),
            post: (...args: unknown[]) => postMock(...args),
            put: (...args: unknown[]) => putMock(...args),
            processing: false,
            errors: formErrors,
        };
    },
}));

// The Ziggy `route()` helper is injected globally by the Blade view in the
// real app; tests set it explicitly.
vi.stubGlobal('route', routeMock);

const { default: Login } = await import('./Auth/Login');
const { default: Register } = await import('./Auth/Register');
const { default: Welcome } = await import('./Welcome');
const { default: Dashboard } = await import('./Dashboard');
const { default: NotesIndex } = await import('./Notes/Index');
const { default: AlgorithmIndex } = await import('./Algorithm/Index');

describe('Welcome', () => {
    it('shows guest links when logged out and the dashboard link when logged in', () => {
        const { unmount } = render(<Welcome />);
        expect(screen.getByText('Log in')).toBeTruthy();
        expect(screen.getByText('Create account')).toBeTruthy();
        unmount();

        pageProps = { ...pageProps, auth: { user: { id: 1, name: 'Ada', email: 'a@b.co' } } };
        render(<Welcome />);
        expect(screen.getByText('Go to dashboard')).toBeTruthy();
    });
});

describe('Login', () => {
    it('submits email and password through Inertia useForm', async () => {
        const user = userEvent.setup();
        render(<Login />);
        await user.type(screen.getByLabelText('Email'), 'ada@example.com');
        await user.type(screen.getByLabelText('Password'), 'correcthorse1');
        await user.click(screen.getByRole('button', { name: 'Log in' }));
        expect(postMock).toHaveBeenCalledWith('/login/store');
    });

    it('renders the generic error banner for non-credential errors from the error bag', () => {
        // Credential errors ("These credentials do not match our records.")
        // deliberately render inline under the email field (same design as
        // the stack-15 Vue page); the alert banner is for other failures
        // such as throttling responses.
        formErrors = { email: 'Too many login attempts. Please try again in 60 seconds.' };
        render(<Login />);
        expect(screen.getByRole('alert').textContent).toBe(
            'Too many login attempts. Please try again in 60 seconds.',
        );
    });

    it('renders credential errors inline under the email field', () => {
        formErrors = { email: 'These credentials do not match our records.' };
        render(<Login />);
        expect(screen.getByText('These credentials do not match our records.')).toBeTruthy();
        expect(screen.queryByRole('alert')).toBeNull();
    });
});

describe('Register', () => {
    it('submits name, email and password', async () => {
        const user = userEvent.setup();
        formErrors = {};
        render(<Register />);
        await user.type(screen.getByLabelText('Name'), 'Ada Lovelace');
        await user.type(screen.getByLabelText('Email'), 'ada@example.com');
        await user.type(screen.getByLabelText('Password'), 'correcthorse1');
        await user.click(screen.getByRole('button', { name: 'Create account' }));
        expect(postMock).toHaveBeenCalledWith('/register/store');
    });
});

describe('Dashboard', () => {
    it('renders profile, metrics and recent notes', () => {
        pageProps = {
            ...pageProps,
            auth: { user: { id: 1, name: 'Ada Lovelace', email: 'ada@example.com' } },
            metrics: [
                { label: 'Notes stored', value: 3 },
                { label: 'Member since', value: '2026-10-25' },
            ],
            recentNotes: [{ id: 7, title: 'First note', created_at: '2026-10-25' }],
        };
        render(<Dashboard />);
        expect(screen.getByText('Ada Lovelace')).toBeTruthy();
        expect(screen.getByText('3')).toBeTruthy();
        expect(screen.getByText('First note')).toBeTruthy();
    });
});

describe('NotesIndex', () => {
    it('shows the empty state and lists notes when present', async () => {
        const { unmount } = render(<NotesIndex notes={[]} />);
        expect(screen.getByText(/Nothing here yet/)).toBeTruthy();
        unmount();

        render(<NotesIndex notes={[{ id: 5, title: 'Groceries', body: 'Milk' }]} />);
        expect(screen.getByText('Groceries')).toBeTruthy();
    });

    it('deletes through the Inertia router with a confirm', async () => {
        const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);
        render(<NotesIndex notes={[{ id: 5, title: 'Groceries', body: null }]} />);
        await userEvent.click(screen.getByRole('button', { name: 'Delete' }));
        expect(deleteMock).toHaveBeenCalledWith('/notes/destroy/5');
        confirmSpy.mockRestore();
    });

    // Review round 2: the pager is EXISTENCE-backed — "Older notes" renders
    // when-and-only-when hasMore is true (a full last page must NOT dead-end),
    // "Newer notes" when-and-only-when page > 1.
    it('hides the Older link on a full last page and shows it only when hasMore', () => {
        const notes = [
            { id: 1, title: 'A', body: null },
            { id: 2, title: 'B', body: null },
        ];

        // Exactly one FULL page (2 of 2 notes, page 1 of 1): no pager at all.
        const unmount1 = render(<NotesIndex notes={notes} page={1} limit={2} total={2} hasMore={false} />).unmount;
        expect(screen.queryByText('Older notes →')).toBeNull();
        expect(screen.queryByText('← Newer notes')).toBeNull();
        unmount1();

        // First page with more data beyond: Older only.
        const unmount2 = render(<NotesIndex notes={notes} page={1} limit={2} total={5} hasMore />).unmount;
        expect(screen.getByText('Older notes →')).toBeTruthy();
        expect(screen.queryByText('← Newer notes')).toBeNull();
        unmount2();

        // Last page (partial): Newer only.
        const unmount3 = render(
            <NotesIndex notes={[{ id: 5, title: 'E', body: null }]} page={2} limit={2} total={3} hasMore={false} />,
        ).unmount;
        expect(screen.getByText('← Newer notes')).toBeTruthy();
        expect(screen.queryByText('Older notes →')).toBeNull();
        unmount3();

        // Middle page: both.
        const unmount4 = render(<NotesIndex notes={notes} page={2} limit={2} total={5} hasMore />).unmount;
        expect(screen.getByText('← Newer notes')).toBeTruthy();
        expect(screen.getByText('Older notes →')).toBeTruthy();
        unmount4();

        // Legacy prop shape (no pagination props at all): no pager, no crash.
        render(<NotesIndex notes={notes} />);
        expect(screen.queryByText('Older notes →')).toBeNull();
        expect(screen.queryByText('← Newer notes')).toBeNull();
    });
});

describe('Algorithm workbench', () => {
    it('renders the fixed catalog with complexity labels and posts runs', async () => {
        const user = userEvent.setup();
        formErrors = {};
        const catalog = [
            { id: 'reverse', label: 'Reverse text', complexity: 'O(n)', explanation: 'Walks the input once.' },
        ];
        render(<AlgorithmIndex catalog={catalog} maxInputLength={10_000} />);
        expect(screen.getByText('Reverse text (O(n))')).toBeTruthy();
        await user.type(screen.getByLabelText('Input'), 'hello');
        // algorithmId is a required <select>; the submit is blocked until a
        // real option is chosen (mirrors the browser constraint).
        await user.selectOptions(screen.getByLabelText('Algorithm'), 'reverse');
        await user.click(screen.getByRole('button', { name: 'Run' }));
        expect(postMock).toHaveBeenCalledWith('/algorithm/run', { preserveScroll: true, preserveState: true });
    });
});
