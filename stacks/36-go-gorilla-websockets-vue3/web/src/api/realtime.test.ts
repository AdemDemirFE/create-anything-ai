// realtime.test.ts — the hand-written WS client: status transitions and the
// event parse path, against a mock WebSocket (jsdom has no real socket).
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { RealtimeClient } from './realtime'

class MockWebSocket {
  static instances: MockWebSocket[] = []
  static CONNECTING = 0
  static OPEN = 1
  static CLOSING = 2
  static CLOSED = 3

  readyState = MockWebSocket.CONNECTING
  onopen: (() => void) | null = null
  onclose: (() => void) | null = null
  onmessage: ((ev: { data: string }) => void) | null = null
  onerror: (() => void) | null = null
  sent: string[] = []

  constructor(public url: string) {
    MockWebSocket.instances.push(this)
  }
  send(data: string) {
    this.sent.push(data)
  }
  close() {
    this.readyState = MockWebSocket.CLOSED
    this.onclose?.()
  }
  // test helpers
  open() {
    this.readyState = MockWebSocket.OPEN
    this.onopen?.()
  }
  emit(payload: string) {
    this.onmessage?.({ data: payload })
  }
}

beforeEach(() => {
  MockWebSocket.instances = []
  vi.stubGlobal('WebSocket', MockWebSocket as unknown as typeof WebSocket)
  // jsdom provides location with http: protocol
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('RealtimeClient', () => {
  it('connects to ws://…/ws and reaches open', () => {
    const c = new RealtimeClient()
    const statuses: string[] = []
    c.onStatus = (s) => statuses.push(s)
    c.connect()
    expect(MockWebSocket.instances).toHaveLength(1)
    expect(MockWebSocket.instances[0].url).toBe('ws://localhost:3000/ws')
    MockWebSocket.instances[0].open()
    expect(c.status).toBe('open')
    expect(statuses).toContain('open')
    c.disconnect()
  })

  it('parses valid events and exposes the last one', () => {
    const c = new RealtimeClient()
    const events: Record<string, unknown>[] = []
    c.onEvent = (e) => events.push(e as unknown as Record<string, unknown>)
    c.connect()
    const sock = MockWebSocket.instances[0]
    sock.open()
    sock.emit(JSON.stringify({ type: 'run.completed', algorithm_id: 'fizzbuzz' }))
    sock.emit('not-json')
    sock.emit(JSON.stringify({ type: 'pong' }))
    expect(events).toHaveLength(2)
    expect(c.lastEvent?.type).toBe('pong')
    c.disconnect()
  })

  it('reconnects after an unexpected close with backoff', () => {
    vi.useFakeTimers()
    try {
      const c = new RealtimeClient()
      c.connect()
      const first = MockWebSocket.instances[0]
      first.open()
      first.close() // server drop: close() fires onclose (not disposed)
      expect(c.status).toBe('reconnecting')
      vi.advanceTimersByTime(1000) // first backoff = 1s
      expect(MockWebSocket.instances.length).toBe(2) // reconnected
      c.disconnect()
    } finally {
      vi.useRealTimers()
    }
  })

  it('disconnect prevents reconnect attempts', () => {
    vi.useFakeTimers()
    try {
      const c = new RealtimeClient()
      c.connect()
      c.disconnect()
      const count = MockWebSocket.instances.length
      vi.advanceTimersByTime(30_000)
      expect(MockWebSocket.instances.length).toBe(count)
      expect(c.status).toBe('closed')
    } finally {
      vi.useRealTimers()
    }
  })

  it('ping sends an app-level ping frame when open', () => {
    const c = new RealtimeClient()
    c.connect()
    const sock = MockWebSocket.instances[0]
    sock.open()
    c.ping()
    expect(sock.sent).toEqual([JSON.stringify({ type: 'ping' })])
    c.disconnect()
  })
})
