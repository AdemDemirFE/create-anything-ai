<script setup lang="ts">
// LivePanel — the always-mounted WS surface. One RealtimeClient per app;
// the panel renders every broadcast it receives (run.completed, pong…)
// with a live connection status line. This is the Vue-side half of the
// hand-rolled realtime path: raw WebSocket, hand-written reconnect.
import { onMounted, onUnmounted, ref } from 'vue'
import { RealtimeClient, type LiveEvent } from '../api/realtime'

const client = new RealtimeClient()
const status = ref(client.status)
const events = ref<LiveEvent[]>([])
const listEl = ref<HTMLElement | null>(null)

client.onStatus = (s) => {
  status.value = s
}
client.onEvent = (e) => {
  events.value = [e, ...events.value].slice(0, 20)
}

onMounted(() => {
  client.connect()
})

onUnmounted(() => {
  client.disconnect()
})
</script>

<template>
  <section class="card live-panel" aria-label="Live WebSocket events">
    <h2>Live events</h2>
    <p class="status" :class="{ open: status === 'open' }" data-testid="ws-status">
      <span v-if="status === 'open'">● Connected</span>
      <span v-else-if="status === 'connecting'">○ Connecting…</span>
      <span v-else-if="status === 'reconnecting'">○ Reconnecting…</span>
      <span v-else>○ Disconnected</span>
    </p>
    <p v-if="events.length === 0" class="hint">
      No events yet. Run an algorithm to broadcast <code>run.completed</code> to every open tab.
    </p>
    <ul v-else ref="listEl" data-testid="ws-events">
      <li v-for="(e, i) in events" :key="i">
        <strong>{{ e.type }}</strong>
        <template v-if="e.algorithm_id"> · {{ e.algorithm_id }}</template>
        <template v-if="e.execution_ms !== undefined"> · {{ e.execution_ms.toFixed(1) }} ms</template>
        <template v-if="e.email"> · {{ e.email }}</template>
      </li>
    </ul>
  </section>
</template>
