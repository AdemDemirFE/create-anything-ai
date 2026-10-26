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
  IonText,
} from '@ionic/angular/standalone'
import { ApiError } from '../../api/client'
import { AuthService, DocumentDto, DocumentListData } from '../../auth/auth.service'

@Component({
  selector: 'app-documents',
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
    IonText,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <ion-content class="ion-padding">
      <div style="max-width: 640px; margin: 4vh auto 0;">
        <ion-card>
          <ion-card-header>
            <ion-card-title>Documents</ion-card-title>
            <ion-card-subtitle>Owner-scoped CRUD</ion-card-subtitle>
          </ion-card-header>
          <ion-card-content>
            <ion-list inset="true">
              <ion-item>
                <ion-input
                  label="Title"
                  labelPlacement="stacked"
                  type="text"
                  [value]="title()"
                  (ionInput)="title.set($any($event.detail.value))"
                  [maxlength]="200"
                ></ion-input>
              </ion-item>
              <ion-item>
                <ion-input
                  label="Content"
                  labelPlacement="stacked"
                  type="text"
                  [value]="content()"
                  (ionInput)="content.set($any($event.detail.value))"
                  [maxlength]="10000"
                ></ion-input>
              </ion-item>
            </ion-list>
            <ion-button expand="block" (click)="create()" [disabled]="busy()">Add document</ion-button>
            @if (error(); as e) {
              <ion-text color="danger" role="alert" style="display:block; margin-top:12px;"><p>{{ e }}</p></ion-text>
            }
            @if (empty()) {
              <p style="margin-top:16px;">No documents yet — add the first one above.</p>
            }
            <ion-list inset="true">
              @for (d of documents(); track d.id) {
                <ion-item>
                  <ion-label>
                    <h2 data-testid="doc-title">{{ d.title }}</h2>
                    <p>{{ d.content }}</p>
                  </ion-label>
                  <ion-button slot="end" fill="clear" size="small" (click)="remove(d.id)">Delete</ion-button>
                </ion-item>
              }
            </ion-list>
          </ion-card-content>
        </ion-card>
      </div>
    </ion-content>
  `,
})
export class DocumentsPage implements OnInit {
  private readonly auth = inject(AuthService)

  readonly documents = signal<DocumentDto[]>([])
  readonly title = signal('')
  readonly content = signal('')
  readonly busy = signal(false)
  readonly error = signal<string | null>(null)
  readonly empty = signal(false)

  async ngOnInit(): Promise<void> {
    await this.refresh()
  }

  private async refresh(): Promise<void> {
    try {
      const data = await this.auth.client.request<DocumentListData>('/documents?page=1&limit=20')
      this.documents.set(data.documents)
      this.empty.set(data.documents.length === 0)
    } catch (err) {
      this.error.set(err instanceof ApiError ? err.message : 'Failed to load documents.')
    }
  }

  async create(): Promise<void> {
    this.error.set(null)
    this.busy.set(true)
    try {
      await this.auth.client.request<DocumentDto>('/documents', {
        method: 'POST',
        body: { title: this.title(), content: this.content() },
      })
      this.title.set('')
      this.content.set('')
      await this.refresh()
    } catch (err) {
      this.error.set(err instanceof ApiError ? err.message : 'Create failed.')
    } finally {
      this.busy.set(false)
    }
  }

  async remove(id: string): Promise<void> {
    this.error.set(null)
    try {
      await this.auth.client.request<null>(`/documents/${encodeURIComponent(id)}`, { method: 'DELETE' })
      await this.refresh()
    } catch (err) {
      this.error.set(err instanceof ApiError ? err.message : 'Delete failed.')
    }
  }
}
