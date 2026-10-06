import type { ChannelLayout, MemoryLayout, MutexLayout } from './events'

/**
 * A tiny Go-flavoured DSL. Scenario goroutines are generator functions that
 * yield operations; the virtual runtime decides when each one resumes.
 * Blocking is therefore *emergent* — nobody hand-times "now goroutine 4 blocks".
 *
 *   function* producer(go: Go, id: number): Program {
 *     const job = yield go.hold(`job ${id}`)
 *     yield go.move('jobs.send', 9)
 *     yield go.send('jobs', job, 10)   // parks here if the buffer is full
 *   }
 */

export type Op = { line?: number } & (
  | { op: 'go'; fn: string; body: Program }
  | { op: 'move'; to: string }
  | { op: 'sleep'; d: number }
  | { op: 'work'; d: number }
  | { op: 'step' }
  | { op: 'hold'; label: string }
  | { op: 'send'; ch: string; pid: number }
  | { op: 'recv'; ch: string }
  | { op: 'consume'; pid: number }
  | { op: 'makeChan'; ch: string; elem: string; cap: number; layout: ChannelLayout }
  | { op: 'makeMutex'; mu: string; layout: MutexLayout }
  | { op: 'alloc'; mem: string; value: number; layout: MemoryLayout }
  | { op: 'lock'; mu: string }
  | { op: 'unlock'; mu: string }
  | { op: 'read'; mem: string }
  | { op: 'write'; mem: string; value: number }
  | { op: 'wgAdd'; wg: string; n: number }
  | { op: 'wgDone'; wg: string }
  | { op: 'wgWait'; wg: string }
  | { op: 'print'; text: string }
)

// Resume values are typed loosely on purpose: `recv` yields a pid, `read` a value.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Program = Generator<Op, void, any>

export const go = {
  /** `go fn()` — spawn a goroutine. */
  spawn: (fn: string, body: Program, line?: number): Op => ({ op: 'go', fn, body, line }),
  move: (to: string, line?: number): Op => ({ op: 'move', to, line }),
  sleep: (d: number, line?: number): Op => ({ op: 'sleep', d, line }),
  work: (d: number, line?: number): Op => ({ op: 'work', d, line }),
  /** Highlight a line without doing anything else. */
  step: (line: number): Op => ({ op: 'step', line }),
  hold: (label: string, line?: number): Op => ({ op: 'hold', label, line }),
  send: (ch: string, pid: number, line?: number): Op => ({ op: 'send', ch, pid, line }),
  recv: (ch: string, line?: number): Op => ({ op: 'recv', ch, line }),
  consume: (pid: number, line?: number): Op => ({ op: 'consume', pid, line }),
  makeChan: (ch: string, elem: string, cap: number, layout: ChannelLayout, line?: number): Op => ({
    op: 'makeChan', ch, elem, cap, layout, line,
  }),
  makeMutex: (mu: string, layout: MutexLayout, line?: number): Op => ({ op: 'makeMutex', mu, layout, line }),
  alloc: (mem: string, value: number, layout: MemoryLayout, line?: number): Op => ({
    op: 'alloc', mem, value, layout, line,
  }),
  lock: (mu: string, line?: number): Op => ({ op: 'lock', mu, line }),
  unlock: (mu: string, line?: number): Op => ({ op: 'unlock', mu, line }),
  read: (mem: string, line?: number): Op => ({ op: 'read', mem, line }),
  write: (mem: string, value: number, line?: number): Op => ({ op: 'write', mem, value, line }),
  wgAdd: (wg: string, n: number, line?: number): Op => ({ op: 'wgAdd', wg, n, line }),
  wgDone: (wg: string, line?: number): Op => ({ op: 'wgDone', wg, line }),
  wgWait: (wg: string, line?: number): Op => ({ op: 'wgWait', wg, line }),
  print: (text: string, line?: number): Op => ({ op: 'print', text, line }),
}
