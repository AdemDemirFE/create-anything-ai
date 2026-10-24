# Verification — Stack 08 (supabase-react-vite)

**Verified at (local):** 2026-10-25, ~01:20–01:30 UTC+3
**Branch:** `feat/stack-08-supabase-react-vite`
**Scope rule:** every claim below is tied to a command that actually ran in
this session. Anything not run is marked **UNVERIFIED** with the reason.

## 1. Environment

| Tool | Version | Source |
|---|---|---|
| Node.js | v24.19.0 | `node --version` |
| npm | bundled with Node 24 | `npm.cmd install` runs |
| Docker | **daemon NOT running / not exercised** | blocks `supabase local` and any RLS runtime check (see §7) |
| gh CLI | logged in as AdemDemirFE | `gh auth status` |

Dependency versions are **pinned** in `web/package-lock.json`
(react/react-dom 18.3.1, @types/react 18.3.31, @types/react-dom 18.3.7,
@supabase/supabase-js 2.118.0, react-router-dom 7.9.4, vite 7.3.7,
vitest 4.1.12, typescript 5.9.3, @testing-library/react 16.3.1,
@testing-library/jest-dom 6.9.1, @vitejs/plugin-react 5.1.0,
@types/node 24.19.2). Availability of every pin was checked against the npm
registry before pinning, and the install below is the proof they resolve.
jest-dom 6.10.0 (broken release) is explicitly avoided.

## 2. Web — `npm test` + `npm run build` (REAL, PASSED)

Commands (exact):

```powershell
cd stacks/08-supabase-react-vite/web
npm.cmd install          # 175 packages, 0 vulnerabilities (exit noise: esbuild allow-scripts warning only)
npm.cmd test             # vitest run
npm.cmd run build        # tsc --noEmit && vite build
```

Results (final runs on the committed tree):

```text
npm.cmd test        → Test Files 9 passed (9), Tests 80 passed (80), EXIT 0
npm.cmd run build   → tsc clean + ✓ 89 modules transformed, EXIT 0
                      dist/: index.html (0.35 kB), assets/index-*.js (419.03 kB, gzip 122.26 kB)
node scripts/verify-migrations.mjs
                    → verify-migrations: OK — 2 migration file(s), 1 public table(s) [apps],
                      4 policy(ies), all invariants hold (EXIT 0)
```

Earlier intermediate runs showed 81 tests in 10 files; one scratch probe
(`web/probe.test.ts`, no assertions — used during development to pin the fake
GoTrue/PostgREST wire contract) was removed before commit; 80 assertions in
9 files is the final committed state.

Coverage by file (exact per-file counts from the final run):

- `lib/dataApi.test.ts` (15): list/create/get/update/delete against the
  REAL supabase-js client with a fetch-level fake PostgREST; owner-only
  list, NOT_FOUND (never foreign data) for RLS-hidden rows, insert never
  sends user_id (JWT-derived), unique-constraint 23505 → CONFLICT,
  anonymous insert 42501 → FORBIDDEN, transport throw → NETWORK_ERROR,
  client-side validation before any network call.
- `lib/authApi.test.ts` (13): register/login/logout/getSession against REAL
  auth-js with a fetch-level fake GoTrue; `AuthApiError.code` mapping
  (invalid_credentials → INVALID_CREDENTIALS, email_exists → EMAIL_TAKEN),
  `AuthRetryableFetchError` → NETWORK_ERROR (by error name, not code),
  `AuthWeakPasswordError` → WEAK_PASSWORD; invalid/unknown email vs wrong
  password are the same INVALID_CREDENTIALS (no enumeration); session
  persisted in localStorage; client-side weak-password short-circuit →
  VALIDATION_ERROR before the network; request body contains only
  email+password; readSupabaseEnv fails loudly on missing config.
- `lib/migrations.test.ts` (16): positive fixtures (the real two migration
  files audit OK with exactly four owner-scoped policies and no anon
  grants) + negative fixtures (mutated SQL — anon policy, missing RLS
  enable, missing WITH CHECK, implicit PUBLIC role, GRANT to anon, GRANT
  to anon on a function, unbalanced quote — must be *rejected* with the
  right violation) + parser unit tests (comment stripping, escaped quotes,
  semicolons in string literals).
- `lib/envelope.test.ts` (13): auth code mapping (invalid_credentials/
  user_not_found → INVALID_CREDENTIALS, email_exists → EMAIL_TAKEN, weak
  password, rate limit, unknown codes → UNKNOWN without leaking
  internals), PostgREST mapping (PGRST116 → NOT_FOUND, 23505 → CONFLICT,
  42501/403 → FORBIDDEN, 5xx → NETWORK_ERROR), envelope shapes, requestId
  uniqueness, friendly-message table.
- `pages/AppForm.test.tsx` (6): create form (accessible labels, submit
  navigates to detail, validation feedback without a network call,
  duplicate-name conflict alert, maxLength=80 input bound), edit form
  (loads owned app, submits changes, NOT_FOUND for RLS-hidden rows).
- `pages/Auth.test.tsx` (5): register (labels, navigates after success,
  duplicate-email alert, weak-password alert), login (generic failure for
  unknown user AND wrong password — identical copy).
- `pages/Detail.test.tsx` (5): renders owned app fields, NOT_FOUND (never
  foreign data) for an RLS-hidden row, delete navigates back, delete
  failure surfaces instead of navigating, redirect to login without
  session.
- `pages/List.test.tsx` (4): renders owned apps with links, explicit empty
  state, error alert on data-layer failure, redirect to login without
  session.
- `App.test.tsx` (3): route guard — checking state then outlet for a live
  session, redirect of protected routes to /login without a session,
  logout returns to the login route.

## 3. Migrations & static RLS auditor (REAL, PASSED)

- `supabase/migrations/20260101000000_create_apps.sql` — public.apps
  (uuid PK default gen_random_uuid(), user_id uuid not null, name text not
  null check (char_length ≤ 80), description text not null default '',
  check (char_length ≤ 2000), status text check in ('draft','active',
  'archived') default 'draft', created_at/updated_at timestamptz not null
  default now()); RLS enabled + FORCED; 4 owner-only policies (select/
  insert/update/delete) all `to authenticated` using
  `auth.uid() = user_id` (insert via WITH CHECK, update via USING+WITH
  CHECK); updated_at trigger `apps_set_updated_at`.
- `supabase/migrations/20260101000001_seed_demo.sql` — security definer
  helper `public.seed_demo_app(p_user uuid, ...)` (search_path locked,
  executable by authenticated only) that inserts a demo row bypassing RLS
  for the signed-in demo user; revoke from anon.
- Static auditor `scripts/verify-migrations.mjs` (exit 0): every public
  table RLS-enabled AND forced; every policy targets `authenticated` only
  (anon/public forbidden); USING/WITH CHECK scope by `auth.uid() =
  user_id` per operation; updated_at trigger present; no GRANT to
  anon/public; no SECURITY DEFINER executable by anon/public. The same
  rules are pinned by `web/src/lib/migrations.test.ts` (positive +
  negative fixtures).

## 4. Type fidelity of the wire contract (REAL, PASSED)

- The tests exercise the REAL `@supabase/supabase-js` 2.118.0 (auth-js +
  postgrest-js under the hood); only `fetch` is faked. The fake was pinned
  against the actual wire: GoTrue error bodies are `{code, msg}` with
  `X-Supabase-Api-Version: 2024-01-01` (an `x-sb-api-version` spelling was
  a real bug caught by the suite); PostgREST filters use `?id=eq.<uuid>`.
- TS strictness: `tsc --noEmit` clean under strict +
  noUnusedLocals/noUnusedParameters; the `Database` type satisfies
  supabase-js 2.118's `GenericSchema` (row/insert/update/relationship
  shapes; row/insert/update declared as **type aliases**, not interfaces —
  interfaces lack implicit index signatures and fail the
  `Row: Record<string, unknown>` constraint, collapsing every query result
  to `never`).

## 5. Security notes

- No secrets committed: `web/.env.example` has non-reusable placeholders
  (`https://your-project.supabase.co` style); **no service_role key
  anywhere in the stack** — the browser bundle holds only the public anon
  key, and RLS is the authorization boundary (documented in supabase.ts
  and ARCHITECTURE.md).
- Test passwords are dictionary-style (`CorrectHorse1`), not real-looking
  credentials; no real email addresses (`.example.test` / `example.test`
  domains).
- Client-side data layer normalizes every provider response into a stable
  `{ok,data,error,requestId}` envelope; provider error codes never leak
  raw into UI copy beyond the friendly-message table.
- The migration auditor treats anonymous access as a violation (policies
  must target `authenticated`, grants to anon/public are rejected), so a
  future migration cannot silently open a table.

## 6. stack.json verification flags

- `manifest`: **true** — structure checked against the catalog (id pattern,
  category `baas`, maturity `proposed`, versions as version-strings,
  verification block); CI validate-catalog re-checks on the PR.
- `unit`: **true** — vitest suite really ran green (80 tests / 9 files).
- `integration`: **false** — no RLS runtime integration was executed
  (Docker daemon down); the static auditor + fake-wire tests are the
  executed evidence.
- `e2e`: **false** — no browser e2e ran.
- `lastVerifiedAt`: 2026-10-25T01:30:00Z (UTC timestamp of the green runs).
- `evidencePath`: `verification.md` (this file).

## 7. Known gaps / unverified areas

| Area | Status | Reason |
|---|---|---|
| RLS runtime behavior (owner-only reads/writes against real Postgres) | **UNVERIFIED** | Docker daemon not running — `supabase start` / `supabase db reset` never executed; policies are statically audited and pinned by tests, but never enforced against a live RLS engine |
| `supabase local` full stack (GoTrue/PostgREST/Kong) | **UNVERIFIED** | same Docker dependency |
| Hosted Supabase run (real project URL + anon key) | **UNVERIFIED** | no hosted project credentials in this environment |
| Browser e2e (Playwright) / manual browser run | **UNVERIFIED** | out of task scope; `npm run preview` + manual flow not exercised in a real browser |
| Lighthouse / a11y audit | not implemented | out of scope |

First action when Docker is available: `supabase start && supabase db
reset`, then exercise the four RLS policies with two users (owner vs
other): other-user row reads must return 0 rows, writes must 403 (42501),
and the seed helper must only work for the session user.
