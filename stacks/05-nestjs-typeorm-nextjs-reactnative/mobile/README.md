# Stack 05 — React Native (Expo) shell

UNVERIFIED at runtime (this workspace has no iOS/Android SDK): the shell is
authored + `tsc --noEmit` typechecked against the SAME shared API client the
web app uses, but it has never been executed on a device or emulator.

## Run locally (requires Expo tooling + a device/emulator)

```bash
# from stacks/05-nestjs-typeorm-nextjs-reactnative/mobile
npm install
# point the app at a reachable API host (default targets the Android emulator
# loopback alias 10.0.2.2 on port 4000):
EXPO_PUBLIC_API_BASE=http://<your-lan-ip>:4000/api/v1 npm run android   # or: npm run ios
```

## Screens

The shell exposes the same four-screen journey as the web client
(register / login / home / algorithm) over one shared `ApiClient`
(`../shared/src`), so request building, envelope normalization, the
`X-Request-Id` handling and bounded payloads live in exactly one place.
