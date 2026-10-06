import type { ColonyEvent, EventInit } from '../events'
import { anchorPos, at, dist2D, WALK_SPEED } from '../layout'
import type { World } from '../world'
import type { Dispatch, EventSource } from './types'
import { WebSocketSource, type LinkStatus } from './websocketSource'

/**
 * Turns a live stream into something a person can watch.
 *
 * Real requests finish in microseconds, so the director replays the stream in
 * slow motion. It never invents or reorders what the producer reported:
 *
 *  - Causal pacing: an event waits for the previous event of the same
 *    goroutine, the same mutex and the same memory cell (a happens-before
 *    order), plus enough time for its consequence to be seen. Unrelated events
 *    proceed in parallel, so fifty arrivals hatch together.
 *  - Implied motion: a goroutine walks to a lock before waiting on it, steps
 *    inside once it holds it, and leaves when its work is done. These moves
 *    are the only events the director adds, and they carry no semantics.
 *  - Montage: each completed critical section speeds the replay up a little,
 *    so the first contenders read clearly and the long tail does not drag.
 *
 * It knows nothing about any particular application.
 */

interface Pending {
  e: ColonyEvent
  prepared: boolean
  notBefore: number
}

export interface LiveHooks {
  /** Start a fresh world for a new run; returns it. */
  reset: () => World
  status: (s: LinkStatus) => void
}

const HOLD_BEFORE_NEXT_RUN = 2.6
const MOVE_SPEED = WALK_SPEED * 1.3

export class LiveDirector implements EventSource {
  readonly kind = 'live'
  private pending: Pending[] = []
  private clock = 0
  private chains = new Map<string, number>()
  private lastRelease = -Infinity
  private sections = 0
  private dispatchFn!: Dispatch
  private world!: World
  private link: WebSocketSource
  private v3: [number, number, number] = [0, 0, 0]
  private v3b: [number, number, number] = [0, 0, 0]

  constructor(
    url: string,
    private readonly hooks: LiveHooks,
  ) {
    this.link = new WebSocketSource(
      url,
      (events) => {
        for (const e of events) this.pending.push({ e, prepared: false, notBefore: 0 })
      },
      hooks.status,
    )
  }

  start(dispatch: Dispatch, world: World) {
    this.dispatchFn = dispatch
    this.world = world
    this.link.connect()
  }

  stop() {
    this.link.close()
  }

  update(dt: number) {
    this.clock += dt
    this.pump()
  }

  // ───────────────────────────────────────────── scheduling

  private pump() {
    const blocked = new Set<string>()
    for (let i = 0; i < this.pending.length; ) {
      const p = this.pending[i]
      const e = p.e

      if (e.type === 'RUN_START') {
        // a new run waits until the previous one has played out
        if (i === 0 && this.clock >= this.lastRelease + HOLD_BEFORE_NEXT_RUN) {
          this.pending.shift()
          this.beginRun(e)
          continue
        }
        break
      }

      const keys = keysOf(e)
      if (keys.some((k) => blocked.has(k))) {
        // held back by an earlier event: everything it orders must wait too
        for (const k of keys) blocked.add(k)
        i++
        continue
      }
      const ready = Math.max(p.notBefore, ...keys.map((k) => this.chains.get(k) ?? 0))
      if (ready > this.clock) {
        for (const k of keys) blocked.add(k)
        i++
        continue
      }
      if (!p.prepared) {
        p.prepared = true
        const lead = this.prepare(e)
        if (lead > 0) {
          p.notBefore = this.clock + lead
          for (const k of keys) blocked.add(k)
          i++
          continue
        }
      }
      this.pending.splice(i, 1)
      this.release(e, keys)
    }
  }

  private beginRun(e: ColonyEvent) {
    this.world = this.hooks.reset()
    this.clock = 0
    this.chains.clear()
    this.sections = 0
    this.emit({ ...e })
    this.lastRelease = this.clock
  }

  private release(e: ColonyEvent, keys: string[]) {
    this.emit({ ...e })
    const speed = this.speed()
    let lead = 0
    // implied motion after the fact: the new owner steps into the protected area
    if (e.type === 'MUTEX_LOCK') lead = this.moveTo(e.gid, `${e.mu}.inside`)
    if (e.type === 'MUTEX_UNLOCK') this.sections++

    for (const k of keys) this.chains.set(k, this.clock + lead + cost(e, k) / speed)
    this.lastRelease = this.clock
  }

  /** Implied motion before an event; returns seconds to wait before releasing it. */
  private prepare(e: ColonyEvent): number {
    const w = this.world
    switch (e.type) {
      case 'MUTEX_WAIT':
      case 'MUTEX_LOCK': {
        const g = w.goroutines.get(e.gid)
        if (!g || g.anchor === `${e.mu}.gate` || g.anchor === `${e.mu}.inside`) return 0
        return this.moveTo(e.gid, `${e.mu}.gate`) * (e.type === 'MUTEX_WAIT' ? 0.4 : 1)
      }
      case 'MEMORY_READ':
      case 'MEMORY_WRITE': {
        // a goroutine inside a critical section reaches the cell from there
        const holds = [...w.mutexes.values()].some((m) => m.owner === e.gid)
        if (holds) return 0
        return this.moveTo(e.gid, `${e.mem}.f`)
      }
      case 'GOROUTINE_DONE': {
        if (!e.outcome) return 0
        // winners carry the response home; the rest peel away
        const target = e.outcome === 'success' ? 'core' : peel(e.gid)
        return this.moveTo(e.gid, target)
      }
    }
    return 0
  }

  private moveTo(gid: number, to: string): number {
    const g = this.world.goroutines.get(gid)
    if (!g || g.anchor === to) return 0
    const d = dist2D(anchorPos(this.world, g.anchor, this.v3), anchorPos(this.world, to, this.v3b))
    const duration = (d / MOVE_SPEED + 0.15) / this.speed()
    this.emit({ type: 'GOROUTINE_MOVE', gid, to, duration })
    return duration
  }

  private speed() {
    return Math.min(5.5, 1 + this.sections * 0.45)
  }

  private emit(e: EventInit) {
    this.dispatchFn({ ...e, t: this.clock } as ColonyEvent)
  }
}

/** Happens-before chains an event belongs to. */
function keysOf(e: ColonyEvent): string[] {
  switch (e.type) {
    case 'GOROUTINE_SPAWN':
      return [`g:${e.gid}`, 'spawn']
    case 'MUTEX_LOCK':
    case 'MUTEX_UNLOCK':
      return [`g:${e.gid}`, `mu:${e.mu}`]
    case 'MEMORY_READ':
    case 'MEMORY_WRITE':
      return [`g:${e.gid}`, `mem:${e.mem}`]
    case 'MEMORY_ALLOC':
    case 'RACE_DETECTED':
      return [`mem:${e.mem}`]
    case 'MUTEX_WAIT':
    case 'GOROUTINE_DONE':
    case 'GOROUTINE_WAKE':
    case 'GOROUTINE_BLOCK':
    case 'PAYLOAD_CREATE':
      return [`g:${e.gid}`]
    default:
      return []
  }
}

/** Seconds a chain needs after an event before its next event reads clearly (at speed 1). */
function cost(e: ColonyEvent, key: string): number {
  const own = key.startsWith('g:')
  switch (e.type) {
    case 'GOROUTINE_SPAWN':
      return own ? 0.55 : 0.06
    case 'MEMORY_READ':
      return own ? 0.5 : 0.25
    case 'MEMORY_WRITE':
      return own ? 0.6 : 0.35
    case 'PAYLOAD_CREATE':
      return 0.35
    case 'MUTEX_UNLOCK':
      return own ? 0.12 : 0.1
    case 'RACE_DETECTED':
      return 0.4
    default:
      return 0
  }
}

/** Where a rejected goroutine walks off to: fanned out toward the viewer. */
function peel(gid: number) {
  const h = ((gid * 2654435761) >>> 0) / 4294967296
  const h2 = ((gid * 40503 + 12345) % 1000) / 1000
  const x = -4.6 + h * 4.2
  const z = 2.6 + h2 * 2.2
  return at(+x.toFixed(2), +z.toFixed(2))
}
