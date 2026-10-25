# Stack 17 — Mobile (React Native / Expo) — UNVERIFIED THIN SHELL

> **Status: UNVERIFIED.** The Expo SDK is not available in this build
> environment, so nothing in this folder has ever been executed: no
> `expo start`, no `expo install`, no type-check against the real RN types,
> no emulator run. Treat every file here as a reviewed design artifact
> until someone runs it on a real toolchain. First actions when an SDK is
> available:
>
> ```bash
> npm install
> npx expo install --fix
> npx tsc --noEmit
> npx expo start
> ```

## What this is

A **thin shell** over the shared layer (`../shared`), which is the part of
the mobile story that IS verified: the API client and envelope
normalization run under Node-based vitest (`../shared/src/api-client.test.ts`)
and cover success/error envelopes, 429 mapping, offline synthesis, bounded
payloads, and URL encoding. The wire format itself is frozen by the Laravel
contract tests (`../laravel/tests/Feature/EnvelopeContractTest.php`) and
exercised end-to-end by the real-HTTP smoke script
(`../laravel/scripts/smoke.mjs`).

`App.tsx` wires the four-screen contract (Register, Login, Home, Notes
CRUD + Algorithm workbench) onto the shared `ApiClient` — no mobile
specific API logic exists here, by design (no fetch calls, no envelope
parsing, no error-code mapping outside `../shared/src`).

## Screens

- Register → POST `/api/v1/register` (shared client)
- Login → POST `/api/v1/login` (session cookie via platform cookie jar)
- Home → GET `/api/v1/home` (profile + safe sample metrics)
- Notes CRUD → GET/POST/DELETE `/api/v1/notes[...]`
- Algorithm workbench → GET `/api/v1/algorithm`, POST `/api/v1/algorithm/run`
  (measured `execution_ms` shown separately from the static `complexity`)

## Security notes (design, unverified)

- Base URL: Android emulator uses `http://10.0.2.2:8000` (host loopback);
  iOS simulator uses `http://localhost:8000`. Real devices must target a
  LAN IP or a deployed TLS origin.
- The platform cookie jar carries the HttpOnly session cookie
  (`stack17_session`). PRD §6 requires native clients to use
  platform-appropriate secure storage — for a production build, replace
  cookie reliance with `expo-secure-store` backed session handling; do not
  store anything in plain AsyncStorage.
- Throttling is enforced server-side (5 failed logins / 60 s → 429 +
  `Retry-After`); the shell only surfaces the mapped error message.
