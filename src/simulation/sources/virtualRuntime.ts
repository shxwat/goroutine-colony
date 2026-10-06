import type { BlockReason, ColonyEvent, EventInit, WaitEdge } from '../events'
import { anchorPos, dist2D, WALK_SPEED } from '../layout'
import type { Op, Program } from '../program'
import type { World } from '../world'
import type { Dispatch, EventSource } from './types'

/** Seconds a payload needs to cross a conduit on a direct hand-off. */
const HANDOFF = 1.15
/** Seconds a payload needs to slide into / out of a buffer slot. */
const SLOT_TRAVEL = 0.75

interface G {
  gid: number
  gen: Program
  /** Sim time this goroutine runs next; null = parked. */
  wakeAt: number | null
  resume: unknown
  /** Emit GOROUTINE_WAKE before stepping (it was asleep or parked). */
  wakeEvent: boolean
  anchor: string
  done: boolean
}

interface Chan {
  cap: number
  buf: number[]
  sendq: { gid: number; pid: number }[]
  recvq: number[]
}

interface Mem {
  value: number
  version: number
  /** In-flight read-modify-write windows: gid → what it saw. */
  reads: Map<number, { version: number; value: number }>
  lastWriter: number | null
}

/**
 * A cooperative, deterministic miniature of the Go scheduler.
 * Runs scenario programs and narrates everything as ColonyEvents.
 */
export class VirtualRuntime implements EventSource {
  readonly kind = 'simulated'

  private now = 0
  private gs = new Map<number, G>()
  private chans = new Map<string, Chan>()
  private mutexes = new Map<string, { owner: number | null; q: number[] }>()
  private wgs = new Map<string, { n: number; waiters: number[] }>()
  private mems = new Map<string, Mem>()
  private nextGid = 1
  private nextPid = 1
  private dispatch!: Dispatch
  private world!: World
  private halted = false
  private raceReported = false

  constructor(
    private readonly name: string,
    private readonly main: () => Program,
  ) {}

  start(dispatch: Dispatch, world: World) {
    this.dispatch = dispatch
    this.world = world
    this.emit({ type: 'RUN_START', program: this.name })
    this.spawn('main.main', this.main(), null, 'main', 0.4)
  }

  stop() {
    this.halted = true
  }

  update(dt: number) {
    if (this.halted) return
    this.now += dt
    for (let guard = 0; guard < 400; guard++) {
      const g = this.nextRunnable()
      if (!g) break
      this.step(g)
      if (this.halted) return
    }
    this.checkDeadlock()
  }

  // ───────────────────────────────────────────── scheduling

  private nextRunnable(): G | null {
    let best: G | null = null
    for (const g of this.gs.values()) {
      if (g.done || g.wakeAt === null || g.wakeAt > this.now) continue
      if (!best || g.wakeAt < best.wakeAt! || (g.wakeAt === best.wakeAt && g.gid < best.gid)) best = g
    }
    return best
  }

  private step(g: G) {
    if (g.wakeEvent) {
      g.wakeEvent = false
      this.emit({ type: 'GOROUTINE_WAKE', gid: g.gid })
    }
    g.wakeAt = null
    const resume = g.resume
    g.resume = undefined
    const r = g.gen.next(resume)
    if (r.done) return this.finish(g)
    this.exec(g, r.value)
  }

  private spawn(fn: string, body: Program, parent: number | null, at: string, delay: number, line?: number) {
    const gid = this.nextGid++
    this.gs.set(gid, { gid, gen: body, wakeAt: this.now + delay, resume: undefined, wakeEvent: false, anchor: at, done: false })
    this.emit({ type: 'GOROUTINE_SPAWN', gid, fn, parent, at, line })
    return gid
  }

  private finish(g: G) {
    g.done = true
    g.wakeAt = null
    this.emit({ type: 'GOROUTINE_DONE', gid: g.gid })
    if (g.gid === 1) {
      this.emit({ type: 'PROGRAM_EXIT' })
      this.halted = true
    }
  }

  private park(g: G, state: 'BLOCKED' | 'WAITING', reason: BlockReason, on: string, line?: number) {
    g.wakeAt = null
    g.wakeEvent = true
    this.emit({ type: 'GOROUTINE_BLOCK', gid: g.gid, state, reason, on, line })
  }

  private ready(gid: number, after: number, resume?: unknown) {
    const g = this.gs.get(gid)
    if (!g || g.done) return
    g.wakeAt = this.now + after
    g.resume = resume
  }

  private emit(e: EventInit) {
    this.dispatch({ ...e, t: this.now } as ColonyEvent)
  }

  // ───────────────────────────────────────────── operations

  private exec(g: G, op: Op) {
    const { gid } = g
    const line = op.line
    const after = (d: number, resume?: unknown) => {
      g.wakeAt = this.now + d
      g.resume = resume
    }

    switch (op.op) {
      case 'go':
        this.spawn(op.fn, op.body, gid, 'core', 0.7, line)
        return after(0.3)

      case 'move': {
        const d = dist2D(anchorPos(this.world, g.anchor), anchorPos(this.world, op.to))
        const duration = Math.max(0.35, d / WALK_SPEED + 0.25)
        g.anchor = op.to
        this.emit({ type: 'GOROUTINE_MOVE', gid, to: op.to, duration, line })
        return after(duration)
      }

      case 'sleep':
        this.emit({ type: 'GOROUTINE_SLEEP', gid, duration: op.d, line })
        g.wakeEvent = true
        return after(op.d)

      case 'work':
        if (line != null) this.emit({ type: 'GOROUTINE_LINE', gid, line })
        return after(op.d)

      case 'step':
        this.emit({ type: 'GOROUTINE_LINE', gid, line })
        return after(0.05)

      case 'hold': {
        const pid = this.nextPid++
        this.emit({ type: 'PAYLOAD_CREATE', gid, pid, label: op.label, line })
        return after(0.25, pid)
      }

      case 'makeChan':
        this.chans.set(op.ch, { cap: op.cap, buf: [], sendq: [], recvq: [] })
        this.emit({ type: 'CHANNEL_MAKE', gid, ch: op.ch, elem: op.elem, cap: op.cap, layout: op.layout, line })
        return after(0.9)

      case 'makeMutex':
        this.mutexes.set(op.mu, { owner: null, q: [] })
        this.emit({ type: 'MUTEX_MAKE', gid, mu: op.mu, layout: op.layout, line })
        return after(0.5)

      case 'alloc': {
        this.mems.set(op.mem, { value: op.value, version: 0, reads: new Map(), lastWriter: null })
        const addr = '0xc0000' + (0x12080 + this.mems.size * 0x18).toString(16)
        this.emit({ type: 'MEMORY_ALLOC', gid, mem: op.mem, value: op.value, addr, layout: op.layout, line })
        return after(0.9)
      }

      case 'send':
        return this.send(g, op.ch, op.pid, line)

      case 'recv':
        return this.recv(g, op.ch, line)

      case 'consume':
        this.emit({ type: 'PAYLOAD_CONSUME', gid, pid: op.pid, line })
        return after(0.35)

      case 'lock': {
        const mu = this.mutexes.get(op.mu)!
        if (mu.owner === null) {
          mu.owner = gid
          this.emit({ type: 'MUTEX_LOCK', gid, mu: op.mu, line })
          return after(0.3)
        }
        mu.q.push(gid)
        g.wakeAt = null
        g.wakeEvent = true
        this.emit({ type: 'MUTEX_WAIT', gid, mu: op.mu, line })
        return
      }

      case 'unlock': {
        const mu = this.mutexes.get(op.mu)!
        mu.owner = null
        this.emit({ type: 'MUTEX_UNLOCK', gid, mu: op.mu, line })
        const next = mu.q.shift()
        if (next != null) {
          mu.owner = next
          this.emit({ type: 'MUTEX_LOCK', gid: next, mu: op.mu })
          this.ready(next, 0.45)
        }
        return after(0.3)
      }

      case 'read': {
        const m = this.mems.get(op.mem)!
        m.reads.set(gid, { version: m.version, value: m.value })
        this.emit({ type: 'MEMORY_READ', gid, mem: op.mem, value: m.value, line })
        return after(0.45, m.value)
      }

      case 'write':
        return this.write(g, op.mem, op.value, line)

      case 'wgAdd': {
        const wg = this.wg(op.wg)
        wg.n += op.n
        if (line != null) this.emit({ type: 'GOROUTINE_LINE', gid, line })
        return after(0.1)
      }

      case 'wgDone': {
        const wg = this.wg(op.wg)
        wg.n = Math.max(0, wg.n - 1)
        if (line != null) this.emit({ type: 'GOROUTINE_LINE', gid, line })
        if (wg.n === 0) for (const w of wg.waiters.splice(0)) this.ready(w, 0.4)
        return after(0.1)
      }

      case 'wgWait': {
        const wg = this.wg(op.wg)
        if (wg.n === 0) return after(0.1)
        wg.waiters.push(gid)
        return this.park(g, 'WAITING', 'sync.WaitGroup.Wait', `wg:${op.wg}`, line)
      }

      case 'print':
        this.emit({ type: 'PROGRAM_OUTPUT', gid, text: op.text, line })
        return after(0.1)
    }
  }

  private send(g: G, name: string, pid: number, line?: number) {
    const ch = this.chans.get(name)!
    const gid = g.gid

    // A receiver is already parked: hand the value straight across.
    const r = ch.recvq.shift()
    if (r != null) {
      this.emit({ type: 'CHANNEL_SEND', gid, ch: name, pid, to: r, line })
      this.emit({ type: 'CHANNEL_RECEIVE', gid: r, ch: name, pid, from: gid })
      this.ready(r, HANDOFF, pid)
      g.wakeAt = this.now + HANDOFF * 0.5
      return
    }

    // Room in the buffer.
    if (ch.buf.length < ch.cap) {
      ch.buf.push(pid)
      this.emit({ type: 'CHANNEL_SEND', gid, ch: name, pid, line })
      if (ch.buf.length === ch.cap) this.emit({ type: 'CHANNEL_BUFFER_FULL', ch: name })
      g.wakeAt = this.now + SLOT_TRAVEL
      return
    }

    // Nowhere to put it. Park at the port, still holding the value.
    ch.sendq.push({ gid, pid })
    this.park(g, 'BLOCKED', 'chan send', name, line)
  }

  private recv(g: G, name: string, line?: number) {
    const ch = this.chans.get(name)!
    const gid = g.gid

    if (ch.buf.length > 0) {
      const wasFull = ch.buf.length === ch.cap
      const pid = ch.buf.shift()!
      this.emit({ type: 'CHANNEL_RECEIVE', gid, ch: name, pid, from: 'buffer', line })
      if (wasFull) this.emit({ type: 'CHANNEL_BUFFER_AVAILABLE', ch: name })
      // A parked sender can now drop its value into the freed slot.
      const s = ch.sendq.shift()
      if (s) {
        ch.buf.push(s.pid)
        this.emit({ type: 'GOROUTINE_WAKE', gid: s.gid })
        this.gs.get(s.gid)!.wakeEvent = false
        this.emit({ type: 'CHANNEL_SEND', gid: s.gid, ch: name, pid: s.pid })
        if (ch.buf.length === ch.cap) this.emit({ type: 'CHANNEL_BUFFER_FULL', ch: name })
        this.ready(s.gid, SLOT_TRAVEL)
      }
      g.wakeAt = this.now + SLOT_TRAVEL + 0.2
      g.resume = pid
      return
    }

    // Unbuffered (or drained): rendezvous with a parked sender.
    const s = ch.sendq.shift()
    if (s) {
      this.emit({ type: 'GOROUTINE_WAKE', gid: s.gid })
      this.gs.get(s.gid)!.wakeEvent = false
      this.emit({ type: 'CHANNEL_SEND', gid: s.gid, ch: name, pid: s.pid, to: gid })
      this.emit({ type: 'CHANNEL_RECEIVE', gid, ch: name, pid: s.pid, from: s.gid, line })
      this.ready(s.gid, HANDOFF * 0.5)
      g.wakeAt = this.now + HANDOFF
      g.resume = s.pid
      return
    }

    ch.recvq.push(gid)
    this.park(g, 'WAITING', 'chan receive', name, line)
  }

  private write(g: G, name: string, value: number, line?: number) {
    const m = this.mems.get(name)!
    const gid = g.gid
    const mine = m.reads.get(gid)
    const holdsLock = [...this.mutexes.values()].some((mu) => mu.owner === gid)
    // Someone else wrote between our read and this write: a lost update.
    const lost = !holdsLock && mine != null && mine.version !== m.version
    const expected = mine ? m.value + (value - mine.value) : value
    const rival = m.lastWriter

    m.value = value
    m.version++
    m.reads.delete(gid)
    this.emit({ type: 'MEMORY_WRITE', gid, mem: name, value, line })

    if (lost && !this.raceReported) {
      this.raceReported = true
      this.emit({ type: 'RACE_DETECTED', mem: name, gids: [gid, rival ?? gid], value, expected, line })
    }
    m.lastWriter = gid
    g.wakeAt = this.now + 0.45
  }

  private wg(name: string) {
    let wg = this.wgs.get(name)
    if (!wg) this.wgs.set(name, (wg = { n: 0, waiters: [] }))
    return wg
  }

  // ───────────────────────────────────────────── deadlock detection

  private checkDeadlock() {
    if (this.halted) return
    let alive = 0
    for (const g of this.gs.values()) {
      if (g.done) continue
      alive++
      if (g.wakeAt !== null) return // something can still make progress
    }
    if (alive === 0) return

    // Everyone is asleep. Build the wait-for graph across mutexes.
    const owners = new Map<number, { mu: string; owner: number }>()
    for (const [name, mu] of this.mutexes) {
      for (const w of mu.q) if (mu.owner != null) owners.set(w, { mu: name, owner: mu.owner })
    }
    const cycle: WaitEdge[] = []
    for (const start of owners.keys()) {
      const seen: number[] = []
      let cur: number | undefined = start
      while (cur != null && owners.has(cur) && !seen.includes(cur)) {
        seen.push(cur)
        cur = owners.get(cur)!.owner
      }
      if (cur === start) {
        for (const gid of seen) {
          const o = owners.get(gid)!
          cycle.push({ gid, waitsFor: o.mu, heldBy: o.owner })
        }
        break
      }
    }
    const asleep = [...this.gs.values()].filter((g) => !g.done).map((g) => g.gid)
    this.emit({ type: 'DEADLOCK_DETECTED', cycle, asleep })
    this.halted = true
  }
}
