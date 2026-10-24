<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { apiGet, apiPost } from '../api/client'
import type { AlgorithmEntry, RunResult } from '../types'
import { resetAuthCache } from '../main'
import LivePanel from '../components/LivePanel.vue'

const router = useRouter()
const catalog = ref<AlgorithmEntry[]>([])
const selected = ref('')
const input = ref('')
const result = ref<RunResult | null>(null)
const error = ref('')
const fieldError = ref('')
const busy = ref(false)
const loading = ref(true)

const MAX_INPUT = 10_000

const selectedEntry = computed(() => catalog.value.find((a) => a.id === selected.value))

onMounted(async () => {
  const envelope = await apiGet<AlgorithmEntry[]>('/api/v1/algorithm')
  loading.value = false
  if (envelope.success && envelope.data) {
    catalog.value = envelope.data
    if (envelope.data.length > 0) selected.value = envelope.data[0].id
    return
  }
  if (envelope.error?.code === 'UNAUTHORIZED') {
    resetAuthCache()
    router.push({ name: 'auth' })
    return
  }
  error.value = envelope.error?.message ?? 'Failed to load the algorithm catalog.'
})

async function run() {
  error.value = ''
  fieldError.value = ''
  result.value = null
  if (input.value.length > MAX_INPUT) {
    fieldError.value = `Input exceeds the maximum of ${MAX_INPUT} characters.`
    return
  }
  busy.value = true
  const envelope = await apiPost<RunResult>('/api/v1/algorithm/run', {
    algorithm_id: selected.value,
    input: input.value,
  })
  busy.value = false
  if (envelope.success && envelope.data) {
    result.value = envelope.data
    return
  }
  if (envelope.error?.code === 'UNAUTHORIZED') {
    resetAuthCache()
    router.push({ name: 'auth' })
    return
  }
  error.value = envelope.error?.message ?? 'Run failed.'
}
</script>

<template>
  <div>
    <div class="card">
      <h1>Algorithm workbench</h1>
      <p class="hint">
        Fixed catalog only — the server never evaluates user-supplied code. Measured duration and
        theoretical Big-O are reported separately.
      </p>

      <p v-if="loading" class="hint">Loading…</p>
      <div v-else-if="error && !result" class="error-banner" role="alert">{{ error }}</div>

      <template v-else>
        <label for="algorithm">Algorithm</label>
        <select id="algorithm" v-model="selected" data-testid="algorithm-select">
          <option v-for="a in catalog" :key="a.id" :value="a.id">{{ a.name }}</option>
        </select>
        <p v-if="selectedEntry" class="hint">{{ selectedEntry.explanation }}</p>

        <label for="input">Input (max {{ MAX_INPUT.toLocaleString() }} characters)</label>
        <textarea
          id="input"
          v-model="input"
          rows="3"
          data-testid="algorithm-input"
          maxlength="10000"
        ></textarea>
        <p class="hint">{{ input.length.toLocaleString() }} / {{ MAX_INPUT.toLocaleString() }}</p>
        <p v-if="fieldError" class="field-error" role="alert">{{ fieldError }}</p>

        <button type="button" data-testid="run-button" :disabled="busy || !selected" @click="run">
          {{ busy ? 'Running…' : 'Run' }}
        </button>

        <template v-if="result">
          <h2 style="margin-top: 1.25rem">Result</h2>
          <pre class="output" data-testid="run-output">{{ result.output }}</pre>
          <p>
            <strong>Measured duration:</strong>
            <span data-testid="measured-ms">{{ result.execution_ms.toFixed(1) }} ms</span>
            (wall clock, 0.1 ms resolution)
          </p>
          <p>
            <strong>Theoretical complexity:</strong>
            <span data-testid="complexity">{{ result.complexity }}</span>
            — independent of the measurement above; small inputs do not prove Big-O.
          </p>
        </template>
      </template>
    </div>

    <LivePanel />
  </div>
</template>
