/**
 * SignalR realtime client for Stack 35.
 *
 * Connects to /hubs/realtime with the same session cookie the REST client
 * uses (credentials flow automatically for same-origin requests). The
 * connection is created lazily and never started by this module; callers
 * decide when to start/stop so React effects own the lifecycle.
 */
import * as signalR from '@microsoft/signalr'

export interface RunEvent {
  type: string
  algorithmId: string
  executionMs: number
  complexity: string
  occurredAt: string
}

export function createRealtimeConnection(): signalR.HubConnection {
  return new signalR.HubConnectionBuilder()
    .withUrl('/hubs/realtime', {
      // Same-origin: the browser attaches the session cookie automatically.
      // (SignalR sends credentials for same-origin negotiate/WebSocket.)
    })
    .withAutomaticReconnect([0, 2000, 5000, 10000])
    .configureLogging(signalR.LogLevel.Warning)
    .build()
}
