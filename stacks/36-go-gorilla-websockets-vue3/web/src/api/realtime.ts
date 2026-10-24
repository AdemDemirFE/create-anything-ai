// Realtime client for Stack 36 — a RAW WebSocket to /ws (the çırak way:
// no library, no negotiate, no automatic reconnect unless we write it).
// Contrast with Stack 35, where @microsoft/signalr owns the protocol.
// The browser attaches the session cookie automatically on same-origin.
//
// Reconnect policy (hand-written, deliberate): exponential backoff
// 1s → 2s → 4s → 8s, capped at 8s, with jitter-free determinism for tests.
// Callers own the lifecycle: connect() on mount, disconnect() on unmount.

export type WsEventHandler = (msg: Record<string, unknown>) => void

export type WsStatus = 'idle' | 'connecting' | 'open' | 'closed' | 'reconnecting'

export interface LiveEvent {
  type: string
  email?: string
  algorithm_id?: string
  execution_ms?: number
  complexity?: string
  occurred_at?: string
  ts?: string
}

const MAX_BACKOFF_MS = 8_000

export class RealtimeClient {
  private ws: WebSocket | null = null
  private attempts = 0
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null
  private disposed = false

  status: WsStatus = 'idle'
  lastEvent: LiveEvent | null = null
  onStatus: ((s: WsStatus) => void) | null = null
  onEvent: ((e: LiveEvent) => void) | null = null

  private setStatus(s: WsStatus) {
    this.status = s
    this.onStatus?.(s)
  }

  connect(): void {
    if (this.disposed) {
      return
    }
    if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) {
      return
    }
    this.disposed = false
    this.setStatus(this.attempts === 0 ? 'connecting' : 'reconnecting')
    const proto = location.protocol === 'https:' ? 'wss' : 'ws'
    this.ws = new WebSocket(`${proto}://${location.host}/ws`)

    this.ws.onopen = () => {
      this.attempts = 0
      this.setStatus('open')
    }
    this.ws.onmessage = (ev) => {
      try {
        const parsed = JSON.parse(ev.data as string) as LiveEvent
        this.lastEvent = parsed
        this.onEvent?.(parsed)
      } catch {
        // Malformed frame: ignored (server never sends raw user content).
      }
    }
    this.ws.onclose = () => {
      if (this.disposed) {
        this.setStatus('closed')
        return
      }
      this.scheduleReconnect()
    }
    this.ws.onerror = () => {
      // onclose follows; nothing to do here.
    }
  }

  private scheduleReconnect() {
    const delay = Math.min(1000 * 2 ** this.attempts, MAX_BACKOFF_MS)
    this.attempts += 1
    this.setStatus('reconnecting')
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null
      if (!this.disposed) this.connect()
    }, delay)
  }

  disconnect(): void {
    this.disposed = true
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer)
      this.reconnectTimer = null
    }
    if (this.ws) {
      this.ws.onclose = null
      this.ws.close()
      this.ws = null
    }
    this.setStatus('closed')
  }

  // App-level ping (mirrors the protocol-level keepalive the server runs).
  ping(): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ type: 'ping' }))
    }
  }
}
