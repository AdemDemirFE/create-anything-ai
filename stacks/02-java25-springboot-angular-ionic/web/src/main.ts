import { bootstrapApplication } from '@angular/platform-browser';

import { AppComponent } from './app/app.component';
import { appConfig } from './app/app.config';

bootstrapApplication(AppComponent, appConfig).catch((error) => {
  // Boot failure is a hard error: log and stop. No retry loop (polling is
  // for DATA refresh, not for broken boots).
  console.error('Application bootstrap failed:', error);
});
