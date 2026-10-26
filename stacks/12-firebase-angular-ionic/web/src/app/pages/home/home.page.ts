import { ChangeDetectionStrategy, Component, OnInit, inject, signal } from '@angular/core'
import { Router } from '@angular/router'
import {
  IonButton,
  IonCard,
  IonCardContent,
  IonCardHeader,
  IonCardSubtitle,
  IonCardTitle,
  IonContent,
  IonItem,
  IonLabel,
  IonList,
  IonSpinner,
  IonText,
} from '@ionic/angular/standalone'
import { ApiError } from '../../api/client'
import { AuthService, HomeData } from '../../auth/auth.service'

@Component({
  selector: 'app-home',
  standalone: true,
  imports: [
    IonButton,
    IonCard,
    IonCardContent,
    IonCardHeader,
    IonCardSubtitle,
    IonCardTitle,
    IonContent,
    IonItem,
    IonLabel,
    IonList,
    IonSpinner,
    IonText,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <ion-content class="ion-padding">
      <div style="max-width: 640px; margin: 4vh auto 0;">
        <ion-card>
          <ion-card-header>
            <ion-card-title>Home</ion-card-title>
            <ion-card-subtitle data-testid="home-email">{{ data()?.user?.email }}</ion-card-subtitle>
          </ion-card-header>
          <ion-card-content>
            @if (loading()) {
              <ion-spinner name="crescent" aria-label="Loading"></ion-spinner>
            } @else {
              @if (error(); as e) {
                <ion-text color="danger" role="alert"><p>{{ e }}</p></ion-text>
              }
              @if (data(); as d) {
                <ion-list inset="true">
                  @for (m of d.metrics; track m.label) {
                    <ion-item>
                      <ion-label>
                        <h2>{{ m.label }}: {{ m.value }} {{ m.unit }}</h2>
                      </ion-label>
                    </ion-item>
                  }
                </ion-list>
              }
            }
            <ion-button expand="block" routerLink="/algorithm">Algorithm workbench</ion-button>
            <ion-button expand="block" routerLink="/documents">Documents</ion-button>
            <ion-button expand="block" fill="outline" color="danger" (click)="logout()">Log out</ion-button>
          </ion-card-content>
        </ion-card>
      </div>
    </ion-content>
  `,
})
export class HomePage implements OnInit {
  private readonly auth = inject(AuthService)
  private readonly router = inject(Router)

  readonly loading = signal(true)
  readonly error = signal<string | null>(null)
  readonly data = signal<HomeData | null>(null)

  async ngOnInit(): Promise<void> {
    try {
      this.data.set(await this.auth.loadHome())
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        await this.router.navigate(['/login'])
        return
      }
      this.error.set(err instanceof ApiError ? err.message : 'Failed to load home.')
    } finally {
      this.loading.set(false)
    }
  }

  async logout(): Promise<void> {
    await this.auth.logout()
    await this.router.navigate(['/login'])
  }
}
