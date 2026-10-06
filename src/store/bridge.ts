import { useEffect } from 'react'
import { scenarioById } from '../scenarios'
import type { ColonyEvent } from '../simulation/events'
import { session } from '../simulation/session'
import { VirtualRuntime } from '../simulation/sources/virtualRuntime'
import { LiveDirector } from '../simulation/sources/liveDirector'
import { formatEvent } from '../ui/format'
import { useColony, type LineMarker, type LogLine } from './colonyStore'

const LOG_SIZE = 5

/**
 * The only link between the per-frame world and React. Loads a source on each
 * run, and folds events into the UI store at most once per animation frame.
 */
export function useSessionBridge() {
  const runKey = useColony((s) => s.runKey)
  const scenarioId = useColony((s) => s.scenarioId)
  const paused = useColony((s) => s.paused)

  useEffect(() => {
    session.paused = paused
  }, [paused])

  useEffect(() => {
    let pending: LogLine[] = []
    let resourcesDirty = false
    let frame = 0
    let replayTimer = 0

    const flush = () => {
      frame = 0
      const world = session.world
      const markers: Record<number, LineMarker[]> = {}
      let last: { line: number; seq: number } | null = null
      for (const g of world.goroutines.values()) {
        if (g.state === 'DONE' || g.line == null) continue
        ;(markers[g.line] ??= []).push({ gid: g.gid, state: g.state })
      }
      const newest = pending.at(-1)
      const state = useColony.getState()
      if (newest) {
        const lineEv = [...pending].reverse().find((l) => l.line != null)
        if (lineEv?.line != null) last = { line: lineEv.line, seq: lineEv.seq }
      }
      useColony.setState({
        stats: world.stats(),
        stream: world.info,
        tally: { requests: world.spawned, ...world.outcomes },
        markers,
        ...(last ? { lastLine: last } : {}),
        ...(pending.length ? { log: [...state.log, ...pending].slice(-LOG_SIZE) } : {}),
        ...(resourcesDirty
          ? {
              resources: {
                channels: [...world.channels.keys()],
                mutexes: [...world.mutexes.keys()],
                memory: [...world.memory.keys()],
              },
            }
          : {}),
      })
      pending = []
      resourcesDirty = false
    }

    const unsub = session.bus.subscribe((e: ColonyEvent) => {
      const line = formatEvent(e, session.world)
      if (line) pending.push(line)
      if (e.type === 'CHANNEL_MAKE' || e.type === 'MUTEX_MAKE' || e.type === 'MEMORY_ALLOC') resourcesDirty = true
      if (e.type === 'PROGRAM_EXIT') scheduleReplay(scenarioById(scenarioId).hold)
      if (e.type === 'DEADLOCK_DETECTED') scheduleReplay(14)
      if (!frame) frame = requestAnimationFrame(flush)
    })

    /** Auto-replay counts simulation-visible time, so pausing holds it. */
    function scheduleReplay(seconds: number) {
      const startClock = session.simTime
      const check = () => {
        if (session.simTime - startClock >= seconds) useColony.getState().replay()
        else replayTimer = window.setTimeout(check, 200)
      }
      replayTimer = window.setTimeout(check, 200)
    }

    const live = useColony.getState().live
    const scenario = scenarioById(scenarioId)
    session.load(
      live
        ? new LiveDirector(live.url, {
            reset: () => {
              const world = session.resetWorld()
              useColony.getState().liveReset()
              resourcesDirty = true
              return world
            },
            status: (s) => useColony.getState().setLinkStatus(s),
          })
        : new VirtualRuntime(scenario.id, scenario.main),
    )

    return () => {
      unsub()
      cancelAnimationFrame(frame)
      clearTimeout(replayTimer)
    }
  }, [runKey, scenarioId])
}
