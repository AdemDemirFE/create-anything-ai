import { Component, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';

import { ApiError, api } from '../api/client';

/**
 * Screen 1 — Register (docs/PRODUCT_REQUIREMENTS.md section 6).
 * Server-side validation is the authority; the page maps envelope errors to
 * field feedback without leaking anything about existing accounts beyond the
 * server's own (single, deliberate) EMAIL_TAKEN signal.
 */
@Component({
  selector: 'app-register-page',
  imports: [FormsModule, RouterLink],
  template: `
    <main class="shell">
      <h1>Create your account</h1>
      <form (ngSubmit)="submit()">
        <label for="email">Email</label>
        <input id="email" name="email" type="email" autocomplete="email" [(ngModel)]="email" required />
        <label for="password">Password</label>
        <input
          id="password"
          name="password"
          type="password"
          autocomplete="new-password"
          [(ngModel)]="password"
          required
        />
        @if (fieldError('email')) {
          <p class="field-error">{{ fieldError('email') }}</p>
        }
        @if (formError) {
          <p class="form-error" role="alert">{{ formError }}</p>
        }
        <button type="submit" [disabled]="busy()">{{ busy() ? 'Creating…' : 'Create account' }}</button>
      </form>
      <p class="switch">Already registered? <a routerLink="/login">Sign in</a></p>
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
      .field-error {
        color: #b42318;
        margin: 0;
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
export class RegisterPageComponent {
  email = '';
  password = '';
  busy = signal(false);
  formError: string | null = null;
  details: Array<{ field: string; code: string }> = [];

  constructor(private router: Router) {}

  fieldError(field: string): string | null {
    const found = this.details.find((detail) => detail.field === field);
    return found ? `Invalid ${field}: ${found.code}` : null;
  }

  async submit(): Promise<void> {
    this.busy.set(true);
    this.formError = null;
    this.details = [];
    try {
      await api.register(this.email, this.password);
      await this.router.navigateByUrl('/home');
    } catch (error) {
      if (error instanceof ApiError) {
        this.formError = error.message;
        this.details = error.details ?? [];
      } else {
        this.formError = 'Unexpected error. Please try again.';
      }
    } finally {
      this.busy.set(false);
    }
  }
}
