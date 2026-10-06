import { useFrame } from '@react-three/fiber'
import { useEffect, useRef } from 'react'
import { Color, MathUtils, Vector3 } from 'three'
import { PALETTE } from '../../entities/palette'
import type { BlockReason } from '../../simulation/events'
import { SPAWN_POS } from '../../simulation/layout'
import { session } from '../../simulation/session'
import { useColony } from '../../store/colonyStore'
import { creatures, ripple } from '../registry'
import { clearSparks, emitBurst, sparkPoints, updateSparks } from './particles'

const v = new Vector3()
const DUST = new Color('#5c7a88')

/** Seconds after detection: freeze → stillness → the runtime speaks. */
export const DEADLOCK_TIMELINE = { freeze: 3.2, reveal: 5.6 }

/**
 * Translates runtime events into physical reactions (sparks, ripples) and
 * drives the global cinematic dials in session.fx (life, glitch, desaturate).
 */
export function FxDirector() {
  const deadlockAt = useRef<number | null>(null)
  const raceAt = useRef<number | null>(null)
  const revealed = useRef(false)
  const setVerdict = useColony((s) => s.setVerdict)

  useEffect(() => {
    clearSparks()
    return session.bus.subscribe((e) => {
      const world = session.world
      switch (e.type) {
        case 'RUN_START':
          deadlockAt.current = null
          raceAt.current = null
          revealed.current = false
          break
        case 'GOROUTINE_SPAWN':
          if (e.at === 'core') emitBurst(v.set(SPAWN_POS[0], 0.35, SPAWN_POS[2]), PALETTE.go, 36, 1.6, { up: 0.9 })
          break
        case 'GOROUTINE_DONE': {
          const c = creatures.get(e.gid)
          if (!c) break
          v.set(c.pos.x, c.bodyY + 0.1, c.pos.z)
          if (e.outcome === 'success') {
            emitBurst(v, PALETTE.payload, 120, 2.4, { up: 1.2, spread: 0.2, life: 1.8 })
            ripple(c.pos.x, c.pos.z, PALETTE.payload, 2)
          } else if (e.outcome) {
            emitBurst(v, PALETTE.ember, 26, 0.9, { up: 0.8, spread: 0.25, life: 1.1 })
          } else {
            emitBurst(v, DUST, 46, 0.5, { up: 1.6, spread: 0.35, life: 2 })
          }
          break
        }
        case 'GOROUTINE_BLOCK': {
          const c = creatures.get(e.gid)
          if (c && e.state === 'BLOCKED') ripple(c.pos.x, c.pos.z, PALETTE.ember, 0.8)
          break
        }
        case 'MUTEX_LOCK': {
          const mu = world.mutexes.get(e.mu)
          if (mu) ripple(mu.layout.pos[0], mu.layout.pos[1], PALETTE.amber, 1.2)
          break
        }
        case 'MUTEX_UNLOCK': {
          const mu = world.mutexes.get(e.mu)
          if (mu) ripple(mu.layout.pos[0], mu.layout.pos[1], PALETTE.go, 0.9)
          break
        }
        case 'MUTEX_WAIT': {
          const c = creatures.get(e.gid)
          if (c) ripple(c.pos.x, c.pos.z, PALETTE.ember, 0.8)
          break
        }
        case 'MEMORY_WRITE': {
          const m = world.memory.get(e.mem)
          if (m) {
            ripple(m.layout.pos[0], m.layout.pos[1], PALETTE.goSoft, 1)
            emitBurst(v.set(m.layout.pos[0], 1.2, m.layout.pos[1]), PALETTE.goSoft, 14, 1.2)
          }
          break
        }
        case 'RACE_DETECTED': {
          raceAt.current = session.clock
          const m = world.memory.get(e.mem)
          if (m) {
            const [x, z] = m.layout.pos
            ripple(x, z, PALETTE.ember, 2.4)
            emitBurst(v.set(x, 1.2, z), PALETTE.ember, 140, 3.2, { up: 0.5, life: 1.6 })
            emitBurst(v.set(x, 1.2, z), PALETTE.go, 70, 2.6, { up: 0.5, life: 1.2 })
          }
          // capture stack frames now, while both goroutines still sit on the racing line
          const frames = e.gids.map((gid) => {
            const g = world.goroutines.get(gid)
            return `${g?.fn ?? 'main.main'}()  main.go:${e.line ?? g?.line ?? 0}`
          })
          window.setTimeout(() => {
            setVerdict({ kind: 'race', mem: e.mem, value: e.value, expected: e.expected, gids: e.gids, frames, title: e.title, detail: e.detail })
          }, 700)
          break
        }
        case 'DEADLOCK_DETECTED':
          deadlockAt.current = session.clock
          break
      }
    })
  }, [setVerdict])

  useFrame(({ gl }) => {
    const dt = session.frameDt
    const fx = session.fx
    updateSparks(dt, gl.getPixelRatio())

    // deadlock: the colony stops breathing, then the runtime speaks
    if (deadlockAt.current != null) {
      const k = session.clock - deadlockAt.current
      fx.life = 1 - MathUtils.smoothstep(k, 0.4, DEADLOCK_TIMELINE.freeze)
      fx.desaturate = MathUtils.smoothstep(k, 0.8, DEADLOCK_TIMELINE.freeze + 1.2) * 0.6
      fx.dim = MathUtils.smoothstep(k, DEADLOCK_TIMELINE.reveal - 0.6, DEADLOCK_TIMELINE.reveal + 0.8) * 0.5
      if (!revealed.current && k > DEADLOCK_TIMELINE.reveal) {
        revealed.current = true
        setVerdict({ kind: 'deadlock', lines: goroutineDump() })
      }
    } else {
      fx.life = MathUtils.damp(fx.life, 1, 3, dt)
      fx.desaturate = MathUtils.damp(fx.desaturate, 0, 3, dt)
      fx.dim = MathUtils.damp(fx.dim, 0, 3, dt)
    }

    // race: a short violent glitch that leaves a scar
    if (raceAt.current != null) {
      const k = session.clock - raceAt.current
      const decay = Math.exp(-k * 1.6)
      const flicker = Math.random() < 0.35 ? 1 : 0.35
      fx.glitch = decay * flicker
      fx.shake = Math.exp(-k * 4)
    } else {
      fx.glitch = MathUtils.damp(fx.glitch, 0, 6, dt)
      fx.shake = 0
    }
  })

  return <primitive object={sparkPoints} />
}

const WAIT_LABEL: Record<BlockReason, string> = {
  'chan send': 'chan send',
  'chan receive': 'chan receive',
  'sync.Mutex.Lock': 'sync.Mutex.Lock',
  'sync.WaitGroup.Wait': 'semacquire',
}

/** A goroutine dump in the shape the Go runtime prints it. */
function goroutineDump(): string[] {
  const world = session.world
  const lines = ['fatal error: all goroutines are asleep - deadlock!', '']
  for (const gid of world.deadlock?.asleep ?? []) {
    const g = world.goroutines.get(gid)
    if (!g) continue
    lines.push(`goroutine ${gid} [${g.reason ? WAIT_LABEL[g.reason] : 'select'}]:`)
    const call =
      g.reason === 'sync.Mutex.Lock'
        ? 'sync.(*Mutex).Lock(...)'
        : g.reason === 'sync.WaitGroup.Wait'
          ? 'sync.(*WaitGroup).Wait(...)'
          : null
    if (call) lines.push(call)
    lines.push(`${g.fn}(...)`)
    lines.push(`\t/colony/main.go:${g.line ?? 0} +0x${(0x1c + gid * 0x24).toString(16)}`)
    lines.push('')
  }
  lines.push('exit status 2')
  return lines
}
