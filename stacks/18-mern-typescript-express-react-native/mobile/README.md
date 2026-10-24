# Stack 18 — Mobile (React Native / Expo) — UNVERIFIED WRAPPER

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

A thin wrapper over the shared layer (`../shared`), which is the part of
the mobile story that IS verified: the API client and envelope
normalization run under Node-based vitest (`../shared/src/api-client.test.ts`)
and cover success/error envelopes, 429 mapping, offline synthesis,
bounded payloads, and URL encoding.

`App.tsx` wires the four-screen contract (Register, Login, Home, Algorithm
workbench) plus the Documents CRUD screen onto `ApiClient` — no mobile
specific API logic exists here, by design.

## Security notes (design, unverified)

- Base URL: Android emulator uses `http://10.0.2.2:4000` (host loopback);
  iOS simulator uses `http://localhost:4000`. Real devices must target a
  LAN IP or a deployed TLS origin.
- The platform cookie jar carries the HttpOnly session cookie. PRD §6
  requires native clients to use platform-appropriate secure storage —
  for a production build, replace cookie reliance with `expo-secure-store`
  backed token handling or `expo-web-session`; do not store anything in
  plain AsyncStorage.
