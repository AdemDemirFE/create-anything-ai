import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core'
import { FormsModule } from '@angular/forms'
import { Router } from '@angular/router'
import {
  IonButton,
  IonContent,
  IonInput,
  IonItem,
  IonLabel,
  IonList,
  IonText,
} from '@ionic/angular/standalone'
import { ApiError } from '../../api/client'
import { AuthService } from '../../auth/auth.service'

@Component({
  selector: 'app-login',
  standalone: true,
  imports: [FormsModule, IonButton, IonContent, IonInput, IonItem, IonList, IonText],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <ion-content class="ion-padding">
      <form (ngSubmit)="submit()" style="max-width: 420px; margin: 8vh auto 0;">
        <ion-list inset="true">
          <ion-item>
            <ion-input
              label="Email"
              labelPlacement="stacked"
              type="email"
              name="email"
              autocomplete="email"
              [value]="email()"
              (ionInput)="email.set($any($event.detail.value))"
              required
            ></ion-input>
          </ion-item>
          <ion-item>
            <ion-input
              label="Password"
              labelPlacement="stacked"
              type="password"
              name="password"
              autocomplete="current-password"
              [value]="password()"
              (ionInput)="password.set($any($event.detail.value))"
              required
            ></ion-input>
          </ion-item>
        </ion-list>
        <ion-button expand="block" type="submit" [disabled]="busy()">Log in</ion-button>
        <ion-button expand="block" fill="clear" routerLink="/register" type="button">Need an account?</ion-button>
        @if (error(); as e) {
          <ion-text color="danger" role="alert" style="display:block; margin-top:12px;">
            <p>{{ e }}</p>
          </ion-text>
        }
      </form>
    </ion-content>
  `,
})
export class LoginPage {
  private readonly auth = inject(AuthService)
  private readonly router = inject(Router)

  readonly email = signal('')
  readonly password = signal('')
  readonly busy = signal(false)
  readonly error = signal<string | null>(null)

  async submit(): Promise<void> {
    this.error.set(null)
    this.busy.set(true)
    try {
      await this.auth.login(this.email(), this.password())
      await this.router.navigate(['/home'])
    } catch (err) {
      this.error.set(err instanceof ApiError ? err.message : 'Login failed.')
    } finally {
      this.busy.set(false)
    }
  }
}
