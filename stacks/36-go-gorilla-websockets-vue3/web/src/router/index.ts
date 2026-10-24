import { createRouter, createWebHistory } from 'vue-router'
import AuthView from '../views/AuthView.vue'
import HomeView from '../views/HomeView.vue'
import AlgorithmView from '../views/AlgorithmView.vue'

// Client-side routing guard mirrors the backend 401s: protected routes are
// checked against the session probe (/api/v1/me) before entering.
export const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/', redirect: '/home' },
    { path: '/auth', name: 'auth', component: AuthView },
    { path: '/home', name: 'home', component: HomeView, meta: { requiresAuth: true } },
    { path: '/algorithm', name: 'algorithm', component: AlgorithmView, meta: { requiresAuth: true } },
  ],
})
