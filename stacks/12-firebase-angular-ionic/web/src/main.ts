import { bootstrapApplication } from '@angular/platform-browser'
import { importProvidersFrom } from '@angular/core'
import { IonicModule } from '@ionic/angular'
import { provideRouter } from '@angular/router'
import { AppComponent } from './app/app.component'
import { routes } from './app/app.routes'

bootstrapApplication(AppComponent, {
  providers: [importProvidersFrom(IonicModule.forRoot({ mode: 'md' })), provideRouter(routes)],
}).catch((err) => console.error(err))
