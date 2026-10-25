import { createRouter, createWebHistory } from 'vue-router'
import { isAuthenticated } from '../auth'

/**
 * Client-side routing guard mirrors the server: protected screens render
 * only with a session; the backend re-checks on every request anyway
 * (PRD §6 Home: "Require authentication at the backend as well as in
 * client routing").
 */
export const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/', redirect: '/login' },
    { path: '/register', name: 'register', component: () => import('../views/RegisterView.vue') },
    { path: '/login', name: 'login', component: () => import('../views/LoginView.vue') },
    { path: '/home', name: 'home', component: () => import('../views/HomeView.vue'), meta: { requiresAuth: true } },
    { path: '/algorithm', name: 'algorithm', component: () => import('../views/AlgorithmView.vue'), meta: { requiresAuth: true } },
    { path: '/documents', name: 'documents', component: () => import('../views/DocumentsView.vue'), meta: { requiresAuth: true } },
    { path: '/:pathMatch(.*)*', name: 'not-found', component: () => import('../views/NotFoundView.vue') },
  ],
})

router.beforeEach(async (to) => {
  if (!to.meta.requiresAuth) return true
  const ok = await isAuthenticated()
  if (!ok) return { name: 'login' }
  return true
})
