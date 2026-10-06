import type {
  BlockReason,
  CellValue,
  ChannelLayout,
  ColonyEvent,
  GState,
  MemoryLayout,
  MutexLayout,
  Outcome,
  Tone,
  WaitEdge,
} from './events'
import { autoMemoryLayout, autoMutexLayout } from './layout'

export interface GoroutineModel {
  gid: number
  fn: string
  parent: number | null
  state: GState
  /** Anchor the goroutine was last sent to (see layout/anchors). */
  anchor: string
  /** Seq of the latest move, so renderers can detect new journeys. */
  moveSeq: number
  moveAt: number
  moveDuration: number
  reason: BlockReason | null
  blockedOn: string | null
  /** Order in which goroutines parked; queues are derived from this. */
  blockSeq: number
  line: number | null
  spawnedAt: number
  doneAt: number | null
  /** Human label from a live source (e.g. a request ID). */
  label: string | null
  outcome: Outcome | null
  status: string | null
}

export type PayloadLoc =
  | { k: 'g'; gid: number }
  | { k: 'slot'; ch: string }
  | { k: 'gone' }

export interface PayloadModel {
  pid: number
  label: string
  loc: PayloadLoc
  /** Channel it is currently travelling through (hand-off or buffer). */
  via: string | null
  /** Bumped whenever loc changes. */
  moveSeq: number
}

export interface ChannelModel {
  name: string
  elem: string
  cap: number
  layout: ChannelLayout
  buffer: number[]
  createdAt: number
  /** Last time something passed through, for glow. */
  activityAt: number
}

export interface MutexModel {
  name: string
  layout: MutexLayout
  owner: number | null
  createdAt: number
  changedAt: number
}

export interface MemoryModel {
  name: string
  label: string
  group: string | null
  addr: string
  value: CellValue
  tone: Tone | null
  layout: MemoryLayout
  createdAt: number
  writes: number
  lastWriteAt: number
  lastWriter: number | null
  lastReadAt: number
  raced: boolean
}

export interface RaceInfo {
  mem: string
  gids: number[]
  value: CellValue
  expected: CellValue
  title: string | null
  detail: string | null
  t: number
}

export interface StreamInfo {
  app: string
  title: string
  fields: { k: string; v: string }[]
  outcomes: Partial<Record<Outcome, string>>
}

export interface DeadlockInfo {
  cycle: WaitEdge[]
  asleep: number[]
  t: number
}

/**
 * The observable state of the colony. The ONLY way to mutate it is apply().
 * Renderers read it every frame; they never write.
 */
export class World {
  t = 0
  program = ''
  goroutines = new Map<number, GoroutineModel>()
  channels = new Map<string, ChannelModel>()
  mutexes = new Map<string, MutexModel>()
  memory = new Map<string, MemoryModel>()
  payloads = new Map<number, PayloadModel>()
  output: { gid: number; text: string; t: number }[] = []
  race: RaceInfo | null = null
  deadlock: DeadlockInfo | null = null
  exited = false
  /** Present when a live source described itself. */
  info: StreamInfo | null = null
  outcomes: Record<Outcome, number> = { success: 0, rejected: 0, error: 0 }
  spawned = 0
  private seq = 0

  apply(e: ColonyEvent) {
    this.t = Math.max(this.t, e.t)
    const seq = e.seq ?? ++this.seq
    const g = 'gid' in e && e.gid != null ? this.goroutines.get(e.gid) : undefined
    if (g && e.line != null) g.line = e.line

    switch (e.type) {
      case 'RUN_START':
        this.program = e.program
        break

      case 'STREAM_INFO':
        this.info = { app: e.app, title: e.title, fields: e.fields, outcomes: e.outcomes ?? {} }
        break

      case 'GOROUTINE_SPAWN':
        this.goroutines.set(e.gid, {
          gid: e.gid,
          fn: e.fn,
          parent: e.parent ?? null,
          state: 'RUNNING',
          anchor: e.at,
          moveSeq: 0,
          moveAt: e.t,
          moveDuration: 0,
          reason: null,
          blockedOn: null,
          blockSeq: 0,
          line: e.line ?? null,
          spawnedAt: e.t,
          doneAt: null,
          label: e.label ?? null,
          outcome: null,
          status: null,
        })
        this.spawned++
        break

      case 'GOROUTINE_MOVE':
        if (!g) break
        g.anchor = e.to
        g.moveSeq = seq
        g.moveAt = e.t
        g.moveDuration = e.duration
        break

      case 'GOROUTINE_BLOCK':
        if (g) this.park(g, e.state, e.reason, e.on, seq)
        break

      case 'MUTEX_WAIT':
        if (g) this.park(g, 'BLOCKED', 'sync.Mutex.Lock', e.mu, seq)
        break

      case 'GOROUTINE_SLEEP':
        if (g) g.state = 'SLEEPING'
        break

      case 'GOROUTINE_WAKE':
        if (!g || g.state === 'DONE') break
        g.state = 'RUNNING'
        g.reason = null
        g.blockedOn = null
        break

      case 'GOROUTINE_DONE':
        if (!g) break
        g.state = 'DONE'
        g.reason = null
        g.blockedOn = null
        g.doneAt = e.t
        if (e.outcome) {
          g.outcome = e.outcome
          g.status = e.status ?? null
          this.outcomes[e.outcome]++
        }
        // values a goroutine was still holding die with it
        for (const p of this.payloads.values()) {
          if (p.loc.k === 'g' && p.loc.gid === e.gid) {
            p.loc = { k: 'gone' }
            p.via = null
            p.moveSeq = seq
          }
        }
        break

      case 'CHANNEL_MAKE':
        this.channels.set(e.ch, {
          name: e.ch,
          elem: e.elem,
          cap: e.cap,
          layout: e.layout,
          buffer: [],
          createdAt: e.t,
          activityAt: -1,
        })
        break

      case 'PAYLOAD_CREATE':
        this.payloads.set(e.pid, {
          pid: e.pid,
          label: e.label,
          loc: { k: 'g', gid: e.gid },
          via: null,
          moveSeq: seq,
        })
        break

      case 'CHANNEL_SEND': {
        const ch = this.channels.get(e.ch)
        const p = this.payloads.get(e.pid)
        if (!ch || !p) break
        ch.activityAt = e.t
        p.via = e.ch
        p.moveSeq = seq
        if (e.to != null) {
          p.loc = { k: 'g', gid: e.to }
        } else {
          ch.buffer.push(e.pid)
          p.loc = { k: 'slot', ch: e.ch }
        }
        break
      }

      case 'CHANNEL_RECEIVE': {
        const ch = this.channels.get(e.ch)
        const p = this.payloads.get(e.pid)
        if (!ch || !p) break
        ch.activityAt = e.t
        if (e.from === 'buffer') {
          const i = ch.buffer.indexOf(e.pid)
          if (i >= 0) ch.buffer.splice(i, 1)
          p.loc = { k: 'g', gid: e.gid }
          p.via = e.ch
          p.moveSeq = seq
        }
        break
      }

      case 'PAYLOAD_CONSUME': {
        const p = this.payloads.get(e.pid)
        if (!p) break
        p.loc = { k: 'gone' }
        p.via = null
        p.moveSeq = seq
        break
      }

      case 'MUTEX_MAKE':
        if (this.mutexes.has(e.mu)) break
        this.mutexes.set(e.mu, {
          name: e.mu,
          layout: e.layout ?? autoMutexLayout(this.mutexes.size),
          owner: null,
          createdAt: e.t,
          changedAt: e.t,
        })
        break

      case 'MUTEX_LOCK': {
        const mu = this.mutexes.get(e.mu)
        if (!mu) break
        mu.owner = e.gid
        mu.changedAt = e.t
        // acquiring the lock ends the wait, whoever reports it
        if (g && g.reason === 'sync.Mutex.Lock' && g.blockedOn === e.mu) {
          g.state = 'RUNNING'
          g.reason = null
          g.blockedOn = null
        }
        break
      }

      case 'MUTEX_UNLOCK': {
        const mu = this.mutexes.get(e.mu)
        if (!mu) break
        if (mu.owner === e.gid) mu.owner = null
        mu.changedAt = e.t
        break
      }

      case 'MEMORY_ALLOC': {
        if (this.memory.has(e.mem)) break
        const group = e.group ?? null
        const index = group ? [...this.memory.values()].filter((m) => m.group === group).length : this.memory.size
        this.memory.set(e.mem, {
          name: e.mem,
          label: e.label ?? e.mem,
          group,
          addr: e.addr ?? '',
          value: e.value,
          tone: e.tone ?? null,
          layout: e.layout ?? autoMemoryLayout(index, group != null),
          createdAt: e.t,
          writes: 0,
          lastWriteAt: -1,
          lastWriter: null,
          lastReadAt: -1,
          raced: false,
        })
        break
      }

      case 'MEMORY_READ': {
        const m = this.memory.get(e.mem)
        if (!m) break
        m.lastReadAt = e.t
        // a read is an observation of the true value at that moment
        m.value = e.value
        if (e.tone) m.tone = e.tone
        break
      }

      case 'MEMORY_WRITE': {
        const m = this.memory.get(e.mem)
        if (!m) break
        m.value = e.value
        if (e.tone) m.tone = e.tone
        m.writes++
        m.lastWriteAt = e.t
        m.lastWriter = e.gid
        break
      }

      case 'RACE_DETECTED': {
        const m = this.memory.get(e.mem)
        if (m) m.raced = true
        this.race = {
          mem: e.mem,
          gids: e.gids,
          value: e.value,
          expected: e.expected,
          title: e.title ?? null,
          detail: e.detail ?? null,
          t: e.t,
        }
        break
      }

      case 'DEADLOCK_DETECTED':
        this.deadlock = { cycle: e.cycle, asleep: e.asleep, t: e.t }
        break

      case 'PROGRAM_OUTPUT':
        this.output.push({ gid: e.gid, text: e.text, t: e.t })
        break

      case 'PROGRAM_EXIT':
        this.exited = true
        break
    }
  }

  private park(g: GoroutineModel, state: GState, reason: BlockReason, on: string, seq: number) {
    g.state = state
    g.reason = reason
    g.blockedOn = on
    g.blockSeq = seq
  }

  /** Goroutines parked on a resource for a reason, in arrival order. */
  queue(on: string, reason: BlockReason): GoroutineModel[] {
    const q: GoroutineModel[] = []
    for (const g of this.goroutines.values()) {
      if (g.blockedOn === on && g.reason === reason && g.state !== 'DONE') q.push(g)
    }
    return q.sort((a, b) => a.blockSeq - b.blockSeq)
  }

  stats() {
    const s = { total: 0, RUNNING: 0, WAITING: 0, BLOCKED: 0, SLEEPING: 0, DONE: 0 }
    for (const g of this.goroutines.values()) {
      s[g.state]++
      if (g.state !== 'DONE') s.total++
    }
    return s
  }
}
