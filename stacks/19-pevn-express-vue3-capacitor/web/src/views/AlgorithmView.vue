<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { RouterLink } from 'vue-router'
import { api, ApiError } from '../api/client'
import type { AlgorithmInfo, AlgorithmRunResult } from '../api/client'

/**
 * Journey D — Algorithm workbench.
 * Security model: the client can only choose a fixed algorithm and supply
 * bounded text. It never sends code for evaluation. Measured duration
 * (executionMs) is displayed separately from theoretical Big-O (complexity).
 */
const MAX_INPUT = 10_000
const catalog = ref<AlgorithmInfo[] | null>(null)
const selected = ref('')
const input = ref('')
const running = ref(false)
const result = ref<AlgorithmRunResult | null>(null)
const error = ref<string | null>(null)

onMounted(async () => {
  try {
    const envelope = await api.algorithms()
    catalog.value = envelope.data
    selected.value = envelope.data?.[0]?.id ?? ''
  } catch (err) {
    error.value =
      err instanceof ApiError && err.status === 401
        ? 'Please log in first.'
        : 'Could not load the algorithm catalog.'
  }
})

const selectedInfo = computed(() => catalog.value?.find((a) => a.id === selected.value) ?? null)

async function onRun() {
  running.value = true
  error.value = null
  result.value = null
  try {
    const envelope = await api.runAlgorithm(selected.value, input.value)
    if (envelope.data) result.value = envelope.data
  } catch (err) {
    error.value = err instanceof ApiError ? err.message : 'Unexpected error. Please try again.'
  } finally {
    running.value = false
  }
}
</script>

<template>
  <main>
    <h1>Algorithm workbench</h1>
    <p class="hint">
      Pick a fixed, safe algorithm and bounded input. Your code is never executed — only the
      curated catalog below is available.
    </p>

    <p v-if="catalog === null && !error" aria-busy="true">Loading catalog…</p>
    <p v-if="error" role="alert">{{ error }}</p>

    <form v-if="catalog" @submit.prevent="onRun">
      <label for="algorithm-select">Algorithm</label>
      <select id="algorithm-select" v-model="selected">
        <option v-for="a in catalog" :key="a.id" :value="a.id">
          {{ a.name }} ({{ a.complexity }})
        </option>
      </select>
      <p v-if="selectedInfo" class="hint">{{ selectedInfo.explanation }}</p>

      <label for="algorithm-input">Input (max {{ MAX_INPUT.toLocaleString() }} characters)</label>
      <textarea id="algorithm-input" v-model="input" :maxlength="MAX_INPUT" rows="4" required></textarea>
      <p class="hint">{{ input.length.toLocaleString() }} / {{ MAX_INPUT.toLocaleString() }} characters</p>

      <button type="submit" :disabled="running || !selected || input.length === 0">
        {{ running ? 'Running…' : 'Run' }}
      </button>
    </form>

    <section v-if="result" aria-live="polite">
      <h2>Result</h2>
      <pre class="output">{{ result.output }}</pre>
      <p>Measured duration: {{ result.executionMs.toFixed(1) }} ms (monotonic clock, server-side)</p>
      <p>
        Theoretical complexity: {{ result.complexity }} — {{ result.explanation }}
      </p>
    </section>

    <p><RouterLink to="/home">Back to home</RouterLink></p>
  </main>
</template>
