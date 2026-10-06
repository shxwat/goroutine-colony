/**
 * The Colony wire protocol.
 *
 * Every visual in the colony is a reaction to one of these events. Nothing in
 * the renderer knows about scenarios — it only knows this stream. A simulated
 * runtime produces it today; a real Go program instrumented with a tracer can
 * produce the exact same JSON over a WebSocket tomorrow.
 *
 * All events are plain JSON-serializable objects.
 */

/** Ground-plane coordinate [x, z]. */
export type XZ = [number, number]

export type GState = 'RUNNING' | 'WAITING' | 'BLOCKED' | 'SLEEPING' | 'DONE'

/** Why a goroutine is parked. Mirrors Go's own wait reasons. */
export type BlockReason = 'chan send' | 'chan receive' | 'sync.Mutex.Lock' | 'sync.WaitGroup.Wait'

export interface ChannelLayout {
  /** Ground position of the send port. */
  from: XZ
  /** Ground position of the receive port. */
  to: XZ
}

export interface MutexLayout {
  pos: XZ
  /** Angle (radians, ground plane) the gate faces. 0 = +z (toward camera). */
  gate: number
}

export interface MemoryLayout {
  pos: XZ
}

/** A value in a memory cell: numbers for counters, strings for states like "HELD". */
export type CellValue = number | string

/** How a viewer should colour a value, decided by the producer, not the renderer. */
export type Tone = 'calm' | 'warm' | 'hot'

/** How a goroutine's work ended, for live sources that know (e.g. an HTTP status). */
export type Outcome = 'success' | 'rejected' | 'error'

export interface WaitEdge {
  gid: number
  /** Resource the goroutine is waiting on. */
  waitsFor: string
  /** Goroutine that holds that resource. */
  heldBy: number
}

interface Stamp {
  /** Simulation/trace time in seconds. */
  t: number
  /** Monotonic sequence number, assigned on dispatch. */
  seq?: number
  /** Source line (in the scenario's Go snippet) that produced the event. */
  line?: number
}

export type ColonyEvent = Stamp &
  (
    | { type: 'RUN_START'; program: string }
    /** Live sources describe themselves: a title, a few facts, names for outcomes. */
    | { type: 'STREAM_INFO'; app: string; title: string; fields: { k: string; v: string }[]; outcomes?: Partial<Record<Outcome, string>> }
    | { type: 'GOROUTINE_SPAWN'; gid: number; fn: string; parent?: number | null; at: string; label?: string }
    | { type: 'GOROUTINE_MOVE'; gid: number; to: string; duration: number }
    | { type: 'GOROUTINE_BLOCK'; gid: number; state: 'BLOCKED' | 'WAITING'; reason: BlockReason; on: string }
    | { type: 'GOROUTINE_WAKE'; gid: number }
    | { type: 'GOROUTINE_SLEEP'; gid: number; duration: number }
    | { type: 'GOROUTINE_LINE'; gid: number }
    | { type: 'GOROUTINE_DONE'; gid: number; outcome?: Outcome; status?: string }
    | { type: 'CHANNEL_MAKE'; gid: number; ch: string; elem: string; cap: number; layout: ChannelLayout }
    /** `to` set = direct hand-off to a parked receiver (unbuffered rendezvous). */
    | { type: 'CHANNEL_SEND'; gid: number; ch: string; pid: number; to?: number }
    /** `from` = 'buffer' or the gid of the sender handing off directly. */
    | { type: 'CHANNEL_RECEIVE'; gid: number; ch: string; pid: number; from: 'buffer' | number }
    | { type: 'CHANNEL_BUFFER_FULL'; ch: string }
    | { type: 'CHANNEL_BUFFER_AVAILABLE'; ch: string }
    | { type: 'PAYLOAD_CREATE'; gid: number; pid: number; label: string }
    | { type: 'PAYLOAD_CONSUME'; gid: number; pid: number }
    | { type: 'MUTEX_MAKE'; gid?: number; mu: string; layout?: MutexLayout }
    | { type: 'MUTEX_LOCK'; gid: number; mu: string }
    | { type: 'MUTEX_WAIT'; gid: number; mu: string }
    | { type: 'MUTEX_UNLOCK'; gid: number; mu: string }
    | { type: 'MEMORY_ALLOC'; gid?: number; mem: string; value: CellValue; addr?: string; layout?: MemoryLayout; label?: string; group?: string; tone?: Tone }
    | { type: 'MEMORY_READ'; gid: number; mem: string; value: CellValue; tone?: Tone }
    | { type: 'MEMORY_WRITE'; gid: number; mem: string; value: CellValue; tone?: Tone }
    | { type: 'RACE_DETECTED'; mem: string; gids: number[]; value: CellValue; expected: CellValue; title?: string; detail?: string }
    | { type: 'DEADLOCK_DETECTED'; cycle: WaitEdge[]; asleep: number[] }
    | { type: 'PROGRAM_OUTPUT'; gid: number; text: string }
    | { type: 'PROGRAM_EXIT' }
  )

export type ColonyEventType = ColonyEvent['type']

export type EventOf<T extends ColonyEventType> = Extract<ColonyEvent, { type: T }>

/** An event before it is stamped with a time. */
export type EventInit = ColonyEvent extends infer E ? (E extends ColonyEvent ? Omit<E, 't'> & { t?: number } : never) : never
