import type { ColonyEvent } from '../events'

export type LinkStatus = 'connecting' | 'live' | 'reconnecting'

/**
 * Raw transport for live ColonyEvents: one JSON object or an array per
 * message. Reconnects with backoff forever; the server re-sends a full world
 * snapshot (RUN_START …) on every connect, so a reconnect is self-healing.
 */
export class WebSocketSource {
  private ws: WebSocket | null = null
  private closed = false
  private retry = 0
  private timer = 0

  constructor(
    readonly url: string,
    private readonly onEvents: (events: ColonyEvent[]) => void,
    private readonly onStatus: (s: LinkStatus) => void,
  ) {}

  connect() {
    this.closed = false
    this.open()
  }

  close() {
    this.closed = true
    clearTimeout(this.timer)
    this.ws?.close()
    this.ws = null
  }

  private open() {
    this.onStatus(this.retry === 0 ? 'connecting' : 'reconnecting')
    const ws = new WebSocket(this.url)
    this.ws = ws
    ws.onopen = () => {
      this.retry = 0
      this.onStatus('live')
    }
    ws.onmessage = (msg) => {
      try {
        const data = JSON.parse(String(msg.data)) as ColonyEvent | ColonyEvent[]
        this.onEvents(Array.isArray(data) ? data : [data])
      } catch {
        // ignore malformed frames; the stream is advisory, the backend is the truth
      }
    }
    ws.onclose = () => {
      if (this.closed || this.ws !== ws) return
      this.retry++
      this.onStatus('reconnecting')
      this.timer = window.setTimeout(() => this.open(), Math.min(4000, 400 * 2 ** Math.min(this.retry, 4)))
    }
  }
}
