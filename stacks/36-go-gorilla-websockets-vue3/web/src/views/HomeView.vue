<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { apiGet, apiPost, ApiRequestError } from '../api/client'
import type { HomeData } from '../types'
import { resetAuthCache } from '../main'
import LivePanel from '../components/LivePanel.vue'

const router = useRouter()
const home = ref<HomeData | null>(null)
const error = ref('')
const loading = ref(true)

onMounted(async () => {
  const envelope = await apiGet<HomeData>('/api/v1/home')
  loading.value = false
  if (envelope.success && envelope.data) {
    home.value = envelope.data
    return
  }
  if (envelope.error?.code === 'UNAUTHORIZED') {
    resetAuthCache()
    router.push({ name: 'auth' })
    return
  }
  error.value = envelope.error?.message ?? 'Failed to load home.'
})

async function logout() {
  await apiPost('/api/v1/logout')
  resetAuthCache()
  router.push({ name: 'auth' })
}
</script>

<template>
  <div>
    <div class="card">
      <div class="nav" style="margin-bottom: 0.5rem">
        <h1 style="margin: 0">Home</h1>
        <span class="spacer"></span>
        <button class="secondary" data-testid="logout" @click="logout">Log out</button>
      </div>

      <p v-if="loading" class="hint">Loading…</p>
      <div v-else-if="error" class="error-banner" role="alert">{{ error }}</div>

      <template v-else-if="home">
        <p>
          Signed in as <strong data-testid="home-email">{{ home.email }}</strong>
        </p>
        <div class="metrics">
          <div v-for="m in home.metrics" :key="m.label" class="metric">
            <div class="label">{{ m.label }}</div>
            <div class="value">{{ m.value }}</div>
            <div class="unit">{{ m.unit }}</div>
          </div>
        </div>
        <p class="hint" style="margin-top: 0.75rem">Server time: {{ home.server_time }}</p>
      </template>
    </div>

    <LivePanel />
  </div>
</template>
