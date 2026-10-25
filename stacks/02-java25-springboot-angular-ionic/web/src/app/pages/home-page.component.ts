import { Component, OnDestroy, OnInit, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';

import { ApiError, api } from '../api/client';

/**
 * Screen 3 — Home. Loads the authenticated profile + safe sample metrics,
 * with a light POLLING refresh (the only permitted update mechanism in this
 * stack; SSE/WebSocket are FORBIDDEN). Loading, empty, error and
 * unauthorized states are all rendered explicitly.
 */
@Component({
  selector: 'app-home-page',
  imports: [RouterLink],
  template: `
    <main class="shell">
      <header>
        <h1>Home</h1>
        <button type="button" (click)="logout()">Sign out</button>
      </header>

      @if (loading()) {
        <p role="status">Loading…</p>
      } @else if (error()) {
        <p class="form-error" role="alert">{{ error() }}</p>
        <p><a routerLink="/login">Sign in again</a></p>
      } @else if (home()) {
        <section>
          <h2>Welcome</h2>
          <p>{{ home()!.user.email }}</p>
        </section>
        <section>
          <h2>Metrics</h2>
          <ul>
            @for (metric of metricList(); track metric.label) {
              <li>{{ metric.label }}: {{ metric.value }}</li>
            }
          </ul>
        </section>
        <p class="hint">
          Data refreshes by polling every {{ POLL_MS / 1000 }}s. There is no server push in this
          stack by design.
        </p>
        <nav>
          <a routerLink="/algorithm">Open the algorithm workbench</a>
        </nav>
      }
    </main>
  `,
  styles: [
    `
      .shell {
        max-width: 40rem;
        margin: 3rem auto;
        display: grid;
        gap: 1rem;
      }
      header {
        display: flex;
        justify-content: space-between;
        align-items: center;
      }
      .form-error {
        color: #b42318;
      }
      .hint {
        color: #475467;
        font-size: 0.9rem;
      }
    `,
  ],
})
export class HomePageComponent implements OnInit, OnDestroy {
  /** Polling cadence for the home refresh (documented, no SSE in this stack). */
  readonly POLL_MS = 15_000;

  readonly loading = signal(true);
  readonly error = signal<string | null>(null);
  readonly home = signal<{ user: { email: string }; metrics: Record<string, unknown> } | null>(null);

  private pollTimer: ReturnType<typeof setInterval> | null = null;

  constructor(private router: Router) {}

  metricList(): Array<{ label: string; value: unknown }> {
    const data = this.home();
    return data
      ? Object.entries(data.metrics).map(([label, value]) => ({ label, value }))
      : [];
  }

  ngOnInit(): void {
    void this.refresh();
    this.pollTimer = setInterval(() => void this.refresh(), this.POLL_MS);
  }

  ngOnDestroy(): void {
    if (this.pollTimer !== null) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
  }

  async refresh(): Promise<void> {
    try {
      const envelope = await api.home();
      this.home.set(envelope.data);
      this.error.set(null);
    } catch (error) {
      const message =
        error instanceof ApiError ? error.message : 'Unexpected error. Please try again.';
      this.error.set(message);
      if (error instanceof ApiError && (error.status === 401 || error.status === 403)) {
        // Session expired/invalid: drop to login (server is the authority).
        await this.router.navigateByUrl('/login');
      }
    } finally {
      this.loading.set(false);
    }
  }

  async logout(): Promise<void> {
    try {
      await api.logout();
    } finally {
      await this.router.navigateByUrl('/login');
    }
  }
}
