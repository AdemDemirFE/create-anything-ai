<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { RouterLink, useRouter } from 'vue-router'
import { api, ApiError } from '../api/client'
import { resetAuthCache } from '../auth'

/** Journey C — protected Home with loading / empty / error states. */
const router = useRouter()
const loading = ref(true)
const error = ref<string | null>(null)
const email = ref('')
const metrics = ref<Array<{ label: string; value: string; unit: string }>>([])

onMounted(async () => {
  try {
    const envelope = await api.home()
    if (envelope.data) {
      email.value = envelope.data.email
      metrics.value = envelope.data.metrics
    }
  } catch (err) {
    if (err instanceof ApiError && err.status === 401) {
      resetAuthCache()
      router.push({ name: 'login' })
      return
    }
    error.value = err instanceof Error ? err.message : 'Failed to load.'
  } finally {
    loading.value = false
  }
})

async function onLogout() {
  try {
    await api.logout()
  } finally {
    resetAuthCache()
    router.push({ name: 'login' })
  }
}
</script>

<template>
  <main>
    <h1>Home</h1>
    <p v-if="loading" aria-busy="true">Loading…</p>
    <p v-else-if="error" role="alert">Error: {{ error }}</p>
    <template v-else>
      <p>Signed in as <strong>{{ email }}</strong></p>
      <p v-if="metrics.length === 0">No metrics available yet.</p>
      <div class="metrics">
        <div v-for="m in metrics" :key="m.label" class="metric">
          <div class="label">{{ m.label }}</div>
          <div class="value">{{ m.value }}</div>
          <div class="unit">{{ m.unit }}</div>
        </div>
      </div>
      <button type="button" @click="onLogout">Log out</button>
      <p><RouterLink to="/algorithm">Open algorithm workbench</RouterLink></p>
      <p><RouterLink to="/documents">Manage documents</RouterLink></p>
    </template>
  </main>
</template>
