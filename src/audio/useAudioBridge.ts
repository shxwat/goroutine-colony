import { useEffect } from 'react'
import { session } from '../simulation/session'
import { useColony } from '../store/colonyStore'
import { DEADLOCK_TIMELINE } from '../scene/fx/FxDirector'
import { audio } from './sound'

/** Maps runtime events to sound. Silent until the viewer opts in. */
export function useAudioBridge() {
  const muted = useColony((s) => s.muted)
  const verdict = useColony((s) => s.verdict)

  useEffect(() => {
    if (muted) audio.disable()
    else audio.enable()
  }, [muted])

  useEffect(() => {
    if (verdict?.kind === 'deadlock') audio.fatal()
  }, [verdict])

  useEffect(() => {
    const unsub = session.bus.subscribe((e) => {
      switch (e.type) {
        case 'RUN_START':
          audio.restore()
          break
        case 'GOROUTINE_SPAWN':
          if (e.parent != null) audio.spawn()
          break
        case 'CHANNEL_SEND':
          audio.tick(e.to != null ? 0.8 : 1)
          break
        case 'CHANNEL_RECEIVE':
          audio.tick(1.25)
          break
        case 'GOROUTINE_BLOCK':
          if (e.state === 'BLOCKED') audio.block()
          break
        case 'MUTEX_WAIT':
          audio.block()
          break
        case 'MUTEX_LOCK':
          audio.lock()
          break
        case 'MUTEX_UNLOCK':
          audio.unlock()
          break
        case 'MEMORY_WRITE':
          audio.write()
          break
        case 'RACE_DETECTED':
          audio.glitch()
          break
        case 'DEADLOCK_DETECTED':
          audio.drain(DEADLOCK_TIMELINE.freeze)
          break
      }
    })
    return unsub
  }, [])
}
