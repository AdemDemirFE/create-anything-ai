import { Component, OnInit, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';

import { ApiError, api } from '../api/client';

/**
 * Screen 4 — Algorithm workbench. Fixed catalog (fetched once), bounded
 * input (server enforces the cap; the textarea also carries maxlength),
 * measured duration displayed separately from theoretical Big-O.
 * No streaming: each run is a single POST; re-run to refresh.
 */
@Component({
  selector: 'app-algorithm-page',
  imports: [FormsModule, RouterLink],
  template: `
    <main class="shell">
      <header>
        <h1>Algorithm workbench</h1>
        <a routerLink="/home">Back to home</a>
      </header>

      @if (loading()) {
        <p role="status">Loading catalog…</p>
      } @else if (loadError()) {
        <p class="form-error" role="alert">{{ loadError() }}</p>
      } @else {
        <label for="algorithm">Algorithm</label>
        <select id="algorithm" name="algorithm" [(ngModel)]="selected">
          @for (entry of catalog(); track entry.id) {
            <option [value]="entry.id">{{ entry.label }} ({{ entry.complexity }})</option>
          }
        </select>
        <p class="hint">{{ selectedEntry()?.explanation }}</p>

        <label for="input">Input</label>
        <textarea
          id="input"
          name="input"
          rows="4"
          [maxlength]="MAX_INPUT_LENGTH"
          [(ngModel)]="input"
        ></textarea>

        @if (runError()) {
          <p class="form-error" role="alert">{{ runError() }}</p>
        }

        <button type="button" (click)="run()" [disabled]="running() || !input().length">
          {{ running() ? 'Running…' : 'Run' }}
        </button>

        @if (result()) {
          <section class="result">
            <h2>Result</h2>
            <pre>{{ result()!.output }}</pre>
            <dl>
              <dt>Measured duration</dt>
              <dd>{{ result()!.executionMs }} ms</dd>
              <dt>Theoretical complexity</dt>
              <dd>{{ result()!.complexity }}</dd>
            </dl>
            <p class="hint">Measured wall-clock time vs the Big-O class are different things.</p>
          </section>
        }
      }
    </main>
  `,
  styles: [
    `
      .shell {
        max-width: 40rem;
        margin: 3rem auto;
        display: grid;
        gap: 0.75rem;
      }
      header {
        display: flex;
        justify-content: space-between;
        align-items: baseline;
      }
      .result pre {
        background: #f2f4f7;
        padding: 0.75rem;
        overflow: auto;
      }
      .form-error {
        color: #b42318;
        margin: 0;
      }
      .hint {
        color: #475467;
        font-size: 0.9rem;
      }
      dl {
        display: grid;
        grid-template-columns: auto 1fr;
        gap: 0.25rem 1rem;
      }
    `,
  ],
})
export class AlgorithmPageComponent implements OnInit {
  readonly MAX_INPUT_LENGTH = 10_000;

  readonly loading = signal(true);
  readonly loadError = signal<string | null>(null);
  readonly catalog = signal<Array<{ id: string; label: string; complexity: string; explanation: string }>>([]);
  readonly selected = signal('reverse');
  readonly input = signal('');
  readonly running = signal(false);
  readonly runError = signal<string | null>(null);
  readonly result = signal<{ output: string; executionMs: number; complexity: string } | null>(null);

  ngOnInit(): void {
    void this.loadCatalog();
  }

  selectedEntry() {
    return this.catalog().find((entry) => entry.id === this.selected()) ?? null;
  }

  private async loadCatalog(): Promise<void> {
    try {
      const envelope = await api.catalog();
      this.catalog.set(envelope.data ?? []);
      this.selected.set(envelope.data?.[0]?.id ?? 'reverse');
      this.loadError.set(null);
    } catch (error) {
      this.loadError.set(
        error instanceof ApiError ? error.message : 'Unexpected error. Please try again.',
      );
    } finally {
      this.loading.set(false);
    }
  }

  async run(): Promise<void> {
    this.running.set(true);
    this.runError.set(null);
    try {
      const envelope = await api.runAlgorithm(this.selected(), this.input());
      this.result.set(envelope.data);
    } catch (error) {
      this.runError.set(
        error instanceof ApiError ? error.message : 'Unexpected error. Please try again.',
      );
    } finally {
      this.running.set(false);
    }
  }
}
