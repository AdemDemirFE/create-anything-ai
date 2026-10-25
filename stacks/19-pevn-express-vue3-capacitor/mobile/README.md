# Stack 19 — Mobile (Capacitor 6 shell)

> **Status: UNVERIFIED.** This shell was **never executed**. The Capacitor /
> Android SDK toolchain was not installed or exercised in the build
> environment, and no APK was produced or launched. Everything below is
> configuration and documentation only. See `../verification.md` for the full
> verified/unverified breakdown.

## What this is

A **thin wrapper** over the web app, not a second app:

- All API calls, envelope handling, and DTO types come from `../shared`
  (the same `ApiClient` the web app uses).
- The Vue app in `../web` is built to `../web/dist`, copied into `./www`,
  and served by the native WebView via Capacitor.
- `capacitor.config.json` points `webDir` at `www`. No business logic lives
  here.

## Layout

```
mobile/
├── capacitor.config.json   # appId ai.createanything.stack19, webDir www
├── package.json            # Capacitor 6.2.1 (core + android + cli)
├── scripts/
│   └── sync-web.mjs        # copies ../web/dist → ./www (run before cap sync)
└── www/                    # generated — gitignored, produced by copy:web
```

## First run (requires Android SDK + JDK 17, not exercised here)

```powershell
# from stacks/19-pevn-express-vue3-capacitor/mobile
npm install
npm run build:web          # builds ../web → ../web/dist
npm run copy:web           # copies ../web/dist → ./www
npx cap add android        # creates ./android native project
npx cap sync
npx cap open android       # opens Android Studio; run from there
```

## Pointing the shell at a reachable API

The WebView loads the app from the `https://` app origin, so a relative
`/api/v1` base URL hits the app scheme, not your server. To talk to a real
backend, build a client with an absolute base URL — for the Android emulator
that is `http://10.0.2.2:<PORT>` (host loopback), e.g. `http://10.0.2.2:4000/api/v1`.

Note: `cleartext http://` to 10.0.2.2 requires the Android project to allow
cleartext traffic to that host; prefer an `https://` origin behind a proxy for
anything beyond a local dev emulator. Because the session cookie is
`SameSite=Lax` + `HttpOnly`, cookie auth works in the native WebView as long as
the webview origin and the API origin are treated consistently by the platform.
That cookie behavior on Android WebView is itself **unverified**.
