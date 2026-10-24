# Stack 08 — Supabase (BaaS) + React + Vite

Reference implementation for catalog entry
[`08-supabase-react-vite`](../../stacks/catalog.json) (`baas` category).

This stack exists to demonstrate the **BaaS paradigm in its purest form**:
there is **no custom backend**. The browser client talks directly to Supabase —
GoTrue for authentication, PostgREST (via `@supabase/supabase-js` v2) for data —
using the **public anon key**. Authorization is not implemented in application
code at all; it is delegated to **PostgreSQL Row Level Security (RLS)**.

- **Client:** React 18 + Vite 7 + TypeScript SPA (port 5173) with
  `react-router-dom` 7 and `@supabase/supabase-js` 2.
- **Data layer:** a small typed layer (`web/src/lib/`) normalizes every
  provider response into a stable client-side envelope
  `{ ok, data, error, requestId }` with user-safe error codes.
- **Schema:** SQL migrations in `supabase/migrations/` create the `apps` table
  with four owner-scoped RLS policies (`auth.uid() = user_id`) and **no anon
  policies** — anonymous visitors can neither read nor write.
- **Static RLS audit:** `scripts/verify-migrations.mjs` enforces the security
  contract on the SQL text (pinned by tests, including negative fixtures).
- **Paradigm contrast:** stacks 20/35 put a custom API server between browser
  and database and implement §7 as a wire envelope. Here the "backend" is
  Supabase itself; the §7-style envelope is reconstructed client-side in the
  data layer instead (a documented, deliberate deviation — see
  ARCHITECTURE.md §2).

## Quick start

### 1. Database (choose one)

**Option A — hosted Supabase project**

1. Create a project at <https://supabase.com>.
2. Apply the migrations: `supabase link --project-ref <ref>` then
   `supabase db push` (or paste the files from `supabase/migrations/` into the
   Studio SQL editor, in filename order).
3. Copy `.env.example` to `.env` in `web/` and fill `VITE_SUPABASE_URL` and
   `VITE_SUPABASE_ANON_KEY` from Project Settings → API.

**Option B — local Supabase (requires Docker)**

```powershell
cd stacks/08-supabase-react-vite/supabase
supabase start      # applies migrations from supabase/migrations
supabase status     # prints the local URL + anon key for web/.env
```

> `supabase/config.toml` is committed with email confirmation disabled so the
> register → login flow works without SMTP. Docker was not available when this
> stack was authored — the local path is documented but **unverified in
> runtime** (see verification.md §5).

### 2. Optional demo data

Sign up once through the app (or Studio), then run in the SQL editor:

```sql
select public.seed_demo_apps('<the-auth-user-uuid>');
```

The helper refuses to run for a non-existent user and is idempotent. No
credentials are ever seeded.

### 3. Frontend

```powershell
cd stacks/08-supabase-react-vite/web
npm install
npm run dev         # http://localhost:5173
```

### 4. Tests and build

```powershell
cd stacks/08-supabase-react-vite/web
npm test            # vitest run — real supabase-js against a fetch-level fake GoTrue/PostgREST
npm run build       # tsc --noEmit && vite build
node ..\scripts\verify-migrations.mjs   # static RLS audit of the SQL migrations
```

Full command log and evidence: `verification.md`.

## The four screens (PRD §6)

| Screen | Route | Notes |
|---|---|---|
| Register | `/register` | GoTrue `signUp`; duplicate email → `EMAIL_TAKEN`; weak password → `WEAK_PASSWORD` |
| Login | `/login` | GoTrue password grant; unknown user vs wrong password are indistinguishable (`INVALID_CREDENTIALS`) |
| Home / list | `/apps` | RLS-filtered list of the user's apps; empty/error/loading states explicit |
| Detail + form | `/apps/:id`, `/apps/new`, `/apps/:id/edit` | Owner-scoped CRUD; foreign ids resolve to NOT_FOUND via RLS |

(This stack maps the universal Register/Login/Home/Workbench contract onto a
CRUD resource: the "workbench" role is played by the app form. The bounded
algorithm-catalog requirement of §6 applies to stacks that ship an algorithm
workbench; this BaaS reference exercises the same validation posture with
bounded form inputs and DB-level constraints instead.)

## Security model (summary)

- The anon key is public by design; **RLS is the authorization layer**.
- `apps` policies: select/insert/update/delete each restricted
  `to authenticated` with `auth.uid() = user_id` (insert/update also carry
  `WITH CHECK`, so ownership cannot be forged or reassigned).
- No anon policy exists; `force row level security` is set; the seed helper is
  `revoke`d from every browser role.
- The client sends **no `user_id`**: the insert policy derives it from the JWT.
- `.env.example` contains placeholders only; the service_role key is never
  used by the browser. See ARCHITECTURE.md §5 and verification.md §6.
