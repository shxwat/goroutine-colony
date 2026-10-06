import type { ColonyEvent } from '../simulation/events'
import type { World } from '../simulation/world'
import type { LogLine } from '../store/colonyStore'

const label = (world: World, pid: number) => world.payloads.get(pid)?.label ?? `#${pid}`

/** Terse, trace-like narration of an event, or null for events not worth a line. */
export function formatEvent(e: ColonyEvent, world: World): LogLine | null {
  const base = { seq: e.seq ?? 0, t: e.t, line: e.line ?? null }
  const g = (gid: number) => `g${gid}`
  switch (e.type) {
    case 'GOROUTINE_SPAWN':
      return e.parent == null ? null : { ...base, gid: e.gid, tone: 'run', text: `go ${e.fn.replace('main.', '')}()  → ${g(e.gid)}` }
    case 'GOROUTINE_BLOCK':
      return {
        ...base,
        gid: e.gid,
        tone: e.state === 'BLOCKED' ? 'block' : 'wait',
        text: `${g(e.gid)} ${e.state === 'BLOCKED' ? 'blocked' : 'parked'}  [${e.reason}${e.on.startsWith('wg:') ? '' : ` ${e.on}`}]`,
      }
    case 'GOROUTINE_WAKE':
      return { ...base, gid: e.gid, tone: 'run', text: `${g(e.gid)} runnable` }
    case 'GOROUTINE_SLEEP':
      return { ...base, gid: e.gid, tone: 'dim', text: `${g(e.gid)} time.Sleep(${e.duration}s)` }
    case 'GOROUTINE_DONE':
      return e.status
        ? { ...base, gid: e.gid, tone: e.outcome === 'success' ? 'sync' : 'block', text: `${g(e.gid)} → ${e.status}` }
        : { ...base, gid: e.gid, tone: 'dim', text: `${g(e.gid)} exit` }
    case 'CHANNEL_MAKE':
      return { ...base, gid: e.gid, tone: 'sync', text: `make(chan ${e.elem}${e.cap ? `, ${e.cap}` : ''})  ${e.ch}` }
    case 'CHANNEL_SEND':
      return e.to != null
        ? { ...base, gid: e.gid, tone: 'sync', text: `${g(e.gid)} ⇄ ${g(e.to)}  rendezvous on ${e.ch}  ${label(world, e.pid)}` }
        : { ...base, gid: e.gid, tone: 'sync', text: `${e.ch} <- ${label(world, e.pid)}  (${g(e.gid)})` }
    case 'CHANNEL_RECEIVE':
      return e.from === 'buffer' ? { ...base, gid: e.gid, tone: 'sync', text: `<-${e.ch}  ${label(world, e.pid)}  → ${g(e.gid)}` } : null
    case 'CHANNEL_BUFFER_FULL':
      return { ...base, gid: null, tone: 'block', text: `${e.ch}: buffer full` }
    case 'CHANNEL_BUFFER_AVAILABLE':
      return { ...base, gid: null, tone: 'run', text: `${e.ch}: slot free` }
    case 'MUTEX_MAKE':
      return { ...base, gid: e.gid ?? null, tone: 'sync', text: `var ${e.mu} sync.Mutex` }
    case 'MUTEX_LOCK':
      return { ...base, gid: e.gid, tone: 'sync', text: `${g(e.gid)} ${e.mu}.Lock()  acquired` }
    case 'MUTEX_WAIT':
      return { ...base, gid: e.gid, tone: 'block', text: `${g(e.gid)} ${e.mu}.Lock()  contended` }
    case 'MUTEX_UNLOCK':
      return { ...base, gid: e.gid, tone: 'run', text: `${g(e.gid)} ${e.mu}.Unlock()` }
    case 'MEMORY_ALLOC':
      return { ...base, gid: e.gid ?? null, tone: 'sync', text: `${e.label ?? e.mem} = ${e.value}${e.addr ? `  @${e.addr}` : ''}` }
    case 'MEMORY_READ':
      return { ...base, gid: e.gid, tone: 'dim', text: `${g(e.gid)} read  ${e.mem} == ${e.value}` }
    case 'MEMORY_WRITE':
      return { ...base, gid: e.gid, tone: 'run', text: `${g(e.gid)} write ${e.mem} = ${e.value}` }
    case 'RACE_DETECTED':
      return { ...base, gid: null, tone: 'fatal', text: `${e.title ?? 'DATA RACE'} on ${e.mem}: ${g(e.gids[0])} vs ${g(e.gids[1])}` }
    case 'DEADLOCK_DETECTED':
      return { ...base, gid: null, tone: 'fatal', text: `all goroutines are asleep` }
    case 'PROGRAM_OUTPUT':
      return { ...base, gid: e.gid, tone: 'out', text: e.text }
    case 'PROGRAM_EXIT':
      return { ...base, gid: null, tone: 'dim', text: 'exit status 0' }
    default:
      return null
  }
}
