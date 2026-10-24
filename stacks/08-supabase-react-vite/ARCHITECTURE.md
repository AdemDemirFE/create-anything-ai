# Architecture — Stack 08 (Supabase BaaS + React + Vite)

## 1. Components

```
┌──────────────────────────────────────────────────────────────┐
│ Browser (React 18 SPA, Vite build)                           │
│                                                              │
│  pages/  Auth · List · Detail · AppForm                      │
│     │    (consume the envelope; never see the provider)      │
│     ▼                                                        │
│  lib/dataApi.ts · lib/authApi.ts   ← client-side §7 stand-in  │
│     │    (normalize {data,error} → {ok,data,error,requestId})│
│     ▼                                                        │
│  lib/supabase.ts   single typed SupabaseClient<Database>     │
└──────────────┬───────────────────────────────────────────────┘
               │ HTTPS + anon key (public by design)
               ▼
┌──────────────────────────────────────────────────────────────┐
│ Supabase (managed; NO custom server exists in this stack)    │
│  GoTrue    /auth/v1/*      signup, password grant, logout    │
│  PostgREST /rest/v1/apps   CRUD for public.apps              │
│  PostgreSQL: public.apps + RLS (THE authorization layer)     │
└──────────────────────────────────────────────────────────────┘
```

## 2. Paradigm contrast (why the envelope lives client-side)

PRD §7 defines a wire envelope `{success, data, error, meta}` produced by a
custom backend. Stacks 20 and 35 implement it server-side. Stack 08 has **no
backend of ours**: supabase-js returns `{data, error}` pairs for auth and
PostgREST errors carry `{message, code, details, hint}`. The stack contract
therefore moves the envelope into a **client-side data layer**
(`lib/envelope.ts` + `lib/authApi.ts` + `lib/dataApi.ts`) with the shape
`{ ok, data, error, requestId }`:

- `ok` replaces `success`;
- `error` is `{code, message, status}` with **stable codes** (`INVALID_CREDENTIALS`,
  `EMAIL_TAKEN`, `FORBIDDEN`, `NOT_FOUND`, `CONFLICT`, `RATE_LIMITED`,
  `NETWORK_ERROR`, `VALIDATION_ERROR`, `WEAK_PASSWORD`, `UNKNOWN`) mapped from
  GoTrue error codes and Postgres/PostgREST codes (`42501` → `FORBIDDEN`,
  `23505` → `CONFLICT`, `PGRST116` → `NOT_FOUND`, …);
- `requestId` is a generated correlation id (crypto UUID + counter); GoTrue/
  PostgREST do not return a request id the client can read.
- User-facing messages come from a fixed friendly-message table — provider
  internals (`pgrst…`, SQL constraint names) never reach the UI (test-pinned).

This is the stack's documented deviation from the §7 wire contract, and its
point: in a BaaS architecture the *client* owns response normalization, while
the *database* owns authorization.

## 3. Data model and RLS (the authorization layer)

`supabase/migrations/20260101000000_create_apps.sql`:

- `public.apps (id uuid pk, user_id uuid → auth.users on delete cascade, name,
  description, status ∈ {draft, active, archived}, created_at, updated_at,
  unique (user_id, name))` with a `BEFORE UPDATE` trigger maintaining
  `updated_at`.
- RLS **enabled and forced**. Four permissive policies, all
  `to authenticated`:
  - `apps_select_own`  — `using (auth.uid() = user_id)`
  - `apps_insert_own`  — `with check (auth.uid() = user_id)`
  - `apps_update_own`  — `using (...) with check (...)` (ownership cannot be
    reassigned by UPDATE)
  - `apps_delete_own`  — `using (auth.uid() = user_id)`
- **No anon policy**: anonymous sessions get empty result sets (reads) and
  42501 violations (writes). No `for all` catch-all policy exists — each
  operation is enumerated.

The seed migration (`...000001_seed_demo.sql`) installs
`public.seed_demo_apps(uuid)`: `security definer`, refuses unknown users,
idempotent via `on conflict do nothing`, and **revoked from anon and
authenticated** — seeding is an operator action only. No credential material
exists anywhere in the migrations.

## 4. Client structure

| File | Responsibility |
|---|---|
| `lib/database.types.ts` | Hand-written `Database` types mirroring the migration (generated types are the production path; the migration-audit tests pin the correspondence) |
| `lib/supabase.ts` | Singleton typed client; fails loudly at startup when `VITE_SUPABASE_URL`/`VITE_SUPABASE_ANON_KEY` are missing |
| `lib/envelope.ts` | Envelope types, stable error codes, friendly messages, requestId generation |
| `lib/authApi.ts` | register/login/logout/getSession → envelope; client-side pre-validation (email shape, password policy) |
| `lib/dataApi.ts` | list/get/create/update/delete apps → envelope; input bounds mirror DB constraints (name ≤ 80, description ≤ 2000) |
| `pages/*` | The four screens; consume envelopes only |
| `App.tsx` | Shell + auth guard (client half; RLS is the server half) |

## 5. Security decisions

- **Anon key in the browser** is the BaaS model, not a leak: RLS is the
  boundary. The `service_role` key never appears in this stack.
- **Ownership is not client-settable**: the insert policy derives `user_id`
  from the JWT (`auth.uid()`); the client never sends it (the `Insert` type
  marks it optional for exactly this reason).
- **Enumeration**: GoTrue returns the same `invalid_credentials` for unknown
  users and wrong passwords; the UI surfaces that generic message verbatim
  (test-pinned). Duplicate email on register is GoTrue's own
  `email_exists` — the reference reports it as `EMAIL_TAKEN`.
- **Sessions**: GoTrue JWTs (1 h access token in `config.toml`), rotating
  refresh tokens, `autoRefreshToken` on; persisted by supabase-js in
  `localStorage` — acceptable for a browser SPA reference; production builds
  should weigh the trade-offs documented in PRD §6 (Login).
- **Logout** revokes the GoTrue session server-side and clears local storage;
  the shell clears local state even if the network call fails.
- **No secrets in tests**: fixtures use dictionary-style passwords
  (`CorrectHorse1`); `.env.example` has placeholders only.
- **Static RLS audit** (`scripts/verify-migrations.mjs` + tests): every
  migration set must keep RLS enabled+forced, policies scoped to
  `authenticated` with ownership predicates, no anon grants, no anon-executable
  security-definer functions. Negative fixtures prove the auditor rejects
  mutated SQL.

## 6. Testing strategy

- **Real client, fake network**: tests run the genuine `@supabase/supabase-js`
  state machine (localStorage persistence, `expires_at` computation, error
  mapping) against a fetch-level fake GoTrue/PostgREST
  (`src/test/fakeSupabase.ts`) that implements the wire protocols derived from
  the shipped 2.118.0 SDK sources (error bodies `{code, msg}` +
  `x-sb-api-version: 2024-01-01`, session shape, `.single()`/`.maybeSingle()`
  semantics, 204-on-zero-row delete).
- **RLS semantics are simulated at the fake**: owner-only visibility, 42501
  inserts for anon, 406/PGRST116 for hidden rows on `.single()`. These pin the
  *client* behavior; the SQL behavior itself is verified statically (auditor)
  and marked unverified at runtime (no Docker).
- **Page tests** cover the four screens: labels, alerts, navigation, loading/
  empty/error states, and the no-enumeration login property.
- **Negative fixtures** for the migration auditor ensure the security
  contract fails loudly when violated.
