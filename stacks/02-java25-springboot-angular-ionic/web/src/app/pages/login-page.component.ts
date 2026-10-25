import { Component, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';

import { ApiError, api } from '../api/client';

/**
 * Screen 2 — Login. Rate limiting is enforced server-side; this page renders
 * the RATE_LIMITED envelope message verbatim (safe) and never retries
 * automatically (the 429 carries Retry-After; hammering is the user's call,
 * not the client's).
 */
@Component({
  selector: 'app-login-page',
  imports: [FormsModule, RouterLink],
  template: `
    <main class="shell">
      <h1>Sign in</h1>
      <form (ngSubmit)="submit()">
        <label for="email">Email</label>
        <input id="email" name="email" type="email" autocomplete="email" [(ngModel)]="email" required />
        <label for="password">Password</label>
        <input
          id="password"
          name="password"
          type="password"
          autocomplete="current-password"
          [(ngModel)]="password"
          required
        />
        @if (formError) {
          <p class="form-error" role="alert">{{ formError }}</p>
        }
        <button type="submit" [disabled]="busy()">{{ busy() ? 'Signing in…' : 'Sign in' }}</button>
      </form>
      <p class="switch">No account yet? <a routerLink="/register">Create one</a></p>
    </main>
  `,
  styles: [
    `
      .shell {
        max-width: 24rem;
        margin: 3rem auto;
        display: grid;
        gap: 0.75rem;
      }
      label {
        font-weight: 600;
      }
      .form-error {
        color: #b42318;
        margin: 0;
      }
      .switch {
        margin-top: 1rem;
      }
    `,
  ],
})
export class LoginPageComponent {
  email = '';
  password = '';
  busy = signal(false);
  formError: string | null = null;

  constructor(private router: Router) {}

  async submit(): Promise<void> {
    this.busy.set(true);
    this.formError = null;
    try {
      await api.login(this.email, this.password);
      await this.router.navigateByUrl('/home');
    } catch (error) {
      this.formError =
        error instanceof ApiError ? error.message : 'Unexpected error. Please try again.';
    } finally {
      this.busy.set(false);
    }
  }
}
