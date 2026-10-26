# Mobile — Stack 12 (Ionic 8 + Capacitor 7 shell)

**Status: UNVERIFIED** — this environment has no Android SDK / Capacitor CLI
runtime, so `cap add android`, `cap sync` and any emulator run were **never
executed**. This directory ships config + docs only. See
`../verification.md` §6 for the exact scope.

## What is here

- `capacitor.config.json` — appId `ai.createanything.stack12`, `webDir: www`,
  `androidScheme: https` (secure context for cookies in the WebView).
- `package.json` — pinned `@capacitor/core` / `@capacitor/cli` 7.6.9.
- `scripts/sync-web.mjs` — copies the built Angular app
  (`../web/dist/stack12-web/browser`) into `./www` (run after a web build).

## Session model in the WebView (PRD §6 Login)

The stack's session is an **HttpOnly, SameSite=Lax cookie** issued by the
Functions API:

- `androidScheme: https` gives the WebView a secure origin so cookie storage
  behaves like a browser context.
- The API base URL for native builds must point at the deployed Functions
  HTTPS endpoint (set `__STACK12_API__` before bootstrap, e.g. via a build
  define) — the dev proxy in `web/proxy.conf.json` is browser-only.
- Do NOT store tokens in plain preferences; the cookie is the only credential
  and it is invisible to JS by design.

## To verify later (needs Android SDK + a device/emulator)

```bash
npm install
npm run sync-web
npx cap add android
npx cap sync
npx cap open android
```

Then confirm: login sets the cookie, `/home` renders, logout clears it, and
the cookie survives app restarts but not logout.
