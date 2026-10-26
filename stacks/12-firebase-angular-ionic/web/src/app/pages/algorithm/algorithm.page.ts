import { ChangeDetectionStrategy, Component, OnInit, inject, signal } from '@angular/core'
import { FormsModule } from '@angular/forms'
import {
  IonButton,
  IonCard,
  IonCardContent,
  IonCardHeader,
  IonCardSubtitle,
  IonCardTitle,
  IonContent,
  IonInput,
  IonItem,
  IonLabel,
  IonList,
  IonSelect,
  IonSelectOption,
  IonText,
} from '@ionic/angular/standalone'
import { ApiError } from '../../api/client'
import { AlgorithmInfo, AlgorithmRunResult, AuthService } from '../../auth/auth.service'

@Component({
  selector: 'app-algorithm',
  standalone: true,
  imports: [
    FormsModule,
    IonButton,
    IonCard,
    IonCardContent,
    IonCardHeader,
    IonCardSubtitle,
    IonCardTitle,
    IonContent,
    IonInput,
    IonItem,
    IonLabel,
    IonList,
    IonSelect,
    IonSelectOption,
    IonText,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <ion-content class="ion-padding">
      <div style="max-width: 640px; margin: 4vh auto 0;">
        <ion-card>
          <ion-card-header>
            <ion-card-title>Algorithm workbench</ion-card-title>
            <ion-card-subtitle>Fixed catalog — input is data, never code</ion-card-subtitle>
          </ion-card-header>
          <ion-card-content>
            <ion-list inset="true">
              <ion-item>
                <ion-select label="Algorithm" labelPlacement="stacked" [(ngModel)]="selected" interface="popover">
                  @for (a of algorithms(); track a.id) {
                    <ion-select-option [value]="a.id">{{ a.name }} ({{ a.complexity }})</ion-select-option>
                  }
                </ion-select>
              </ion-item>
              <ion-item>
                <ion-input
                  label="Input"
                  labelPlacement="stacked"
                  type="text"
                  [value]="input()"
                  (ionInput)="input.set($any($event.detail.value))"
                  [maxlength]="10000"
                ></ion-input>
              </ion-item>
            </ion-list>
            <ion-button expand="block" (click)="run()" [disabled]="busy() || !selected()">Run</ion-button>
            @if (error(); as e) {
              <ion-text color="danger" role="alert" style="display:block; margin-top:12px;"><p>{{ e }}</p></ion-text>
            }
            @if (result(); as r) {
              <ion-list inset="true">
                <ion-item><ion-label><h2>Output</h2><p data-testid="algo-output">{{ r.output }}</p></ion-label></ion-item>
                <ion-item><ion-label><h2>Measured duration</h2><p>{{ r.durationMs }} ms</p></ion-label></ion-item>
                <ion-item><ion-label><h2>Theoretical complexity</h2><p>{{ r.complexity }}</p></ion-label></ion-item>
                <ion-item><ion-label><h2>Explanation</h2><p>{{ r.explanation }}</p></ion-label></ion-item>
              </ion-list>
            }
          </ion-card-content>
        </ion-card>
      </div>
    </ion-content>
  `,
})
export class AlgorithmPage implements OnInit {
  private readonly auth = inject(AuthService)

  readonly algorithms = signal<AlgorithmInfo[]>([])
  readonly selected = signal<string | null>(null)
  readonly input = signal('')
  readonly busy = signal(false)
  readonly error = signal<string | null>(null)
  readonly result = signal<AlgorithmRunResult | null>(null)

  async ngOnInit(): Promise<void> {
    try {
      const list = await this.auth.client.request<AlgorithmInfo[]>('/algorithms')
      this.algorithms.set(list)
    } catch (err) {
      this.error.set(err instanceof ApiError ? err.message : 'Failed to load algorithms.')
    }
  }

  async run(): Promise<void> {
    const id = this.selected()
    if (!id) return
    this.error.set(null)
    this.busy.set(true)
    try {
      this.result.set(
        await this.auth.client.request<AlgorithmRunResult>(`/algorithms/${encodeURIComponent(id)}/run`, {
          method: 'POST',
          body: { input: this.input() },
        }),
      )
    } catch (err) {
      this.error.set(err instanceof ApiError ? err.message : 'Run failed.')
    } finally {
      this.busy.set(false)
    }
  }
}
