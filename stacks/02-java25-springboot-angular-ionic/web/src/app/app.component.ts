import { Component } from '@angular/core';
import { RouterOutlet } from '@angular/router';

import { appConfig } from './app.config';

/**
 * Root component: renders the routed four-screen app (register / login /
 * home / algorithm workbench). Kept deliberately thin — all structure lives
 * in the routed pages (see app.routes.ts).
 */
@Component({
  selector: 'app-root',
  imports: [RouterOutlet],
  template: `<router-outlet />`,
})
export class AppComponent {}
