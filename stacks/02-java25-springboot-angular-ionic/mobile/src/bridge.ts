/**
 * Thin Ionic/Capacitor bridge for the Stack 02 Angular app.
 *
 * The mobile shell WRAPS the same Angular application as `../web` (the
 * four-screen contract). This module only adds native-aware glue:
 *
 * - the API base URL is configurable so a device can point at a LAN host
 *   (the web client's relative `/api/v1` only works behind the dev proxy);
 * - Capacitor Preferences hold non-sensitive UI state only — the session
 *   cookie stays in the WebView cookie jar (HttpOnly, SameSite), never in
 *   plain preferences.
 *
 * UNVERIFIED: this file has not been compiled or executed on a device (no
 * mobile SDK in the reference environment) — see ../verification.md §3.
 */
import { Preferences } from '@capacitor/preferences';

const API_BASE_KEY = 'stack02.apiBase';

/** Default points at the same-origin proxy used during development. */
export async function resolveApiBase(): Promise<string> {
  const stored = await Preferences.get({ key: API_BASE_KEY });
  return stored.value ?? '/api/v1';
}

export async function setApiBase(value: string): Promise<void> {
  await Preferences.set({ key: API_BASE_KEY, value });
}
