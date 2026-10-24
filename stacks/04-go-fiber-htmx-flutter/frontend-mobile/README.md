# Stack 04 — Flutter mobile client (NOT VERIFIED)

This directory contains the Flutter screen map for the four-screen journey.
**It has never been compiled, analyzed, or tested**: the Flutter SDK is not
available in the implementation environment (see `../verification.md`).

Do NOT claim this code runs. First actions once an SDK exists:

```bash
flutter pub get
flutter analyze
flutter test
```

## Screen map

| Journey | Screen | File | Contract |
|---|---|---|---|
| A — Register | `RegisterScreen` | `lib/screens/register_screen.dart` | `POST /api/v1/register`; VALIDATION_ERROR / EMAIL_TAKEN visible |
| B — Login | `LoginScreen` | `lib/screens/login_screen.dart` | `POST /api/v1/login`; INVALID_CREDENTIALS generic; RATE_LIMITED visible |
| C — Home | `HomeScreen` | `lib/screens/home_screen.dart` | `GET /api/v1/home` protected; 401 → login; logout server-side |
| D — Workbench | `AlgorithmScreen` | `lib/screens/algorithm_screen.dart` | `GET /api/v1/catalog` + `POST /api/v1/algorithm/run`; measured ms vs Big-O separate |

Supporting files:

- `lib/api/api_client.dart` — envelope-aware client; session cookie
  (`STACK04_SESSION`) replayed from `flutter_secure_storage` (never plain
  preferences).
- `lib/main.dart` — bootstrap: restores the cookie, then shows Login.

## Security notes

- The session cookie is stored only in `flutter_secure_storage`.
- No code input exists anywhere: the workbench picks from the fixed catalog.
- Input is capped at 10,000 characters client-side; the server re-validates.
