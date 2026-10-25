import { Component } from '@angular/core';
import { RouterLink } from '@angular/router';

/** Fallback for unknown routes (four-screen app: everything else is 404). */
@Component({
  selector: 'app-not-found',
  template: `
    <main class="shell">
      <h1>Page not found.</h1>
      <a routerLink="/login">Go to sign in</a>
    </main>
  `,
  imports: [RouterLink],
  styles: [
    `
      .shell {
        max-width: 24rem;
        margin: 3rem auto;
        display: grid;
        gap: 0.75rem;
      }
    `,
  ],
})
export class NotFoundComponent {}
