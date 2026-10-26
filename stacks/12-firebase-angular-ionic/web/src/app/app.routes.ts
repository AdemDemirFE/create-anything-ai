import { Routes } from '@angular/router'
import { authGuard } from './auth/auth.guard'

export const routes: Routes = [
  { path: '', redirectTo: 'login', pathMatch: 'full' },
  {
    path: 'login',
    loadComponent: () => import('./pages/login/login.page').then((m) => m.LoginPage),
  },
  {
    path: 'register',
    loadComponent: () => import('./pages/register/register.page').then((m) => m.RegisterPage),
  },
  {
    path: 'home',
    loadComponent: () => import('./pages/home/home.page').then((m) => m.HomePage),
    canActivate: [authGuard],
  },
  {
    path: 'algorithm',
    loadComponent: () => import('./pages/algorithm/algorithm.page').then((m) => m.AlgorithmPage),
    canActivate: [authGuard],
  },
  {
    path: 'documents',
    loadComponent: () => import('./pages/documents/documents.page').then((m) => m.DocumentsPage),
    canActivate: [authGuard],
  },
  { path: '**', redirectTo: 'login' },
]
