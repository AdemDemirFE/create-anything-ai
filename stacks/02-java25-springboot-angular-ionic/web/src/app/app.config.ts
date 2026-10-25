import { ApplicationConfig, provideZoneChangeDetection } from '@angular/core';
import { provideRouter } from '@angular/router';

import { routes } from './app.routes';

/**
 * App-level DI config. The API base is injected through API_BASE (see
 * api/client.ts) so tests can point it anywhere; the Angular app lives on
 * its OWN prefix/origin — the backend serves /api/v1 only (separate
 * prefixes rule).
 */
export const appConfig: ApplicationConfig = {
  providers: [
    provideZoneChangeDetection({ eventCoalescing: true }),
    provideRouter(routes),
  ],
};
