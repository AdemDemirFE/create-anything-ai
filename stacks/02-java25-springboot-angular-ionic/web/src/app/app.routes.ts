import { Routes } from '@angular/router';

import { AlgorithmPageComponent } from './pages/algorithm-page.component';
import { HomePageComponent } from './pages/home-page.component';
import { LoginPageComponent } from './pages/login-page.component';
import { NotFoundComponent } from './pages/not-found.component';
import { RegisterPageComponent } from './pages/register-page.component';

/**
 * Four-screen contract (docs/PRODUCT_REQUIREMENTS.md section 6):
 * register, login, home, algorithm workbench. Client-side routing guards
 * redirect unauthenticated users to /login; the BACKEND is the authority
 * (every protected API call is authenticated server-side too).
 */
export const routes: Routes = [
  { path: '', pathMatch: 'full', redirectTo: 'login' },
  { path: 'register', component: RegisterPageComponent },
  { path: 'login', component: LoginPageComponent },
  { path: 'home', component: HomePageComponent },
  { path: 'algorithm', component: AlgorithmPageComponent },
  { path: '**', component: NotFoundComponent },
];
