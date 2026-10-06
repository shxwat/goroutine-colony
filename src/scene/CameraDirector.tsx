import { OrbitControls } from '@react-three/drei'
import { useFrame, useThree } from '@react-three/fiber'
import { useEffect, useRef } from 'react'
import { MathUtils, Vector3 } from 'three'
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib'
import type { CameraShot } from '../scenarios/types'
import { channelFrame, CORE_POS } from '../simulation/layout'
import { session } from '../simulation/session'
import { useColony } from '../store/colonyStore'
import { DEADLOCK_TIMELINE } from './fx/FxDirector'
import { creatures } from './registry'

interface Focus {
  target: Vector3
  distance: number
  until: number
  /** 0..1 — how far to move from the base shot toward this focus. */
  weight: number
  /** Optional slow push: distance keeps shrinking by this factor over time. */
  push?: number
  start: number
}

/** Seconds of the opening move. */
const INTRO = 3.4
const INTRO_TARGET = new Vector3(CORE_POS[0], 0.9, CORE_POS[2] + 1.6)
const INTRO_DISTANCE = 6.4
const easeInOutCubic = (x: number) => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2)

const desiredTarget = new Vector3()
const desiredPos = new Vector3()
const tmp = new Vector3()

/**
 * A patient cinematographer. Holds the scenario's establishing shot with a
 * slow drift, leans toward congestion, punches in on a race, and creeps toward
 * a deadlock. Gives the camera up the moment the viewer grabs it, and takes it
 * back on replay.
 */
export function CameraDirector({ shot }: { shot: CameraShot }) {
  const controls = useRef<OrbitControlsImpl>(null)
  const camera = useThree((s) => s.camera)
  const dom = useThree((s) => s.gl.domElement)
  const size = useThree((s) => s.size)
  const manual = useRef(false)
  const focus = useRef<Focus | null>(null)
  const curTarget = useRef(new Vector3(...shot.target))
  const curDistance = useRef(shot.distance)
  const runKey = useColony((s) => s.runKey)
  const selected = useColony((s) => s.selected)
  const introAt = useRef(-1)

  // every run opens on the runtime core, then sweeps out to the story
  useEffect(() => {
    manual.current = false
    focus.current = null
    introAt.current = session.clock
  }, [runKey, shot])

  useEffect(() => {
    if (selected != null) manual.current = false
  }, [selected])

  // the viewer takes the camera only when they actually drag or zoom (a click is not a grab)
  useEffect(() => {
    let down: { x: number; y: number } | null = null
    const take = () => {
      manual.current = true
      if (useColony.getState().selected != null) useColony.getState().select(null)
    }
    const onDown = (e: PointerEvent) => (down = { x: e.clientX, y: e.clientY })
    const onMove = (e: PointerEvent) => {
      if (down && Math.hypot(e.clientX - down.x, e.clientY - down.y) > 4) {
        down = null
        take()
      }
    }
    const onUp = () => (down = null)
    dom.addEventListener('pointerdown', onDown)
    dom.addEventListener('wheel', take, { passive: true })
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    return () => {
      dom.removeEventListener('pointerdown', onDown)
      dom.removeEventListener('wheel', take)
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
    }
  }, [dom])

  useEffect(
    () =>
      session.bus.subscribe((e) => {
        const now = session.clock
        const world = session.world
        if (e.type === 'CHANNEL_BUFFER_FULL' || (e.type === 'GOROUTINE_BLOCK' && e.reason === 'chan send')) {
          const ch = world.channels.get(e.type === 'CHANNEL_BUFFER_FULL' ? e.ch : e.on)
          if (!ch) return
          const f = channelFrame(ch.layout)
          const t = new Vector3((f.a[0] * 2 + f.b[0]) / 3, 0.6, (f.a[2] * 2 + f.b[2]) / 3)
          setFocus({ target: t, distance: shot.distance * 0.78, until: now + 4.5, weight: 0.55, start: now })
        }
        if (e.type === 'MUTEX_WAIT') {
          const mu = world.mutexes.get(e.mu)
          if (!mu || focus.current?.push) return
          setFocus({ target: new Vector3(mu.layout.pos[0], 0.5, mu.layout.pos[1] + 0.8), distance: shot.distance * 0.82, until: now + 4, weight: 0.4, start: now })
        }
        if (e.type === 'RACE_DETECTED') {
          const m = world.memory.get(e.mem)
          if (!m) return
          setFocus({ target: new Vector3(m.layout.pos[0], 0.9, m.layout.pos[1]), distance: 6.2, until: now + 5.5, weight: 0.85, start: now })
        }
        if (e.type === 'DEADLOCK_DETECTED') {
          const c = new Vector3()
          let n = 0
          for (const edge of e.cycle) {
            const mu = world.mutexes.get(edge.waitsFor)
            if (mu) {
              c.add(tmp.set(mu.layout.pos[0], 0.4, mu.layout.pos[1]))
              n++
            }
          }
          if (n) c.divideScalar(n)
          else c.set(...shot.target)
          // aim in front of the cycle so it rises into the upper half, above the goroutine dump
          setFocus({ target: c.add(tmp.set(0, 0, 2.4)), distance: shot.distance * 1.02, until: Infinity, weight: 0.9, push: 0.92, start: now })
        }
        if (e.type === 'RUN_START') focus.current = null
      }),
    [shot],
  )

  function setFocus(f: Focus) {
    if (focus.current?.push && !f.push) return
    focus.current = f
  }

  useFrame(() => {
    const ctl = controls.current
    if (!ctl) return
    const now = session.clock
    const dt = Math.min(1 / 20, session.frameDt || 1 / 60)
    const fx = session.fx

    const follow = selected != null ? creatures.get(selected) : undefined
    if (manual.current && !follow) {
      ctl.update()
      return
    }

    // base shot
    desiredTarget.set(...shot.target)
    let distance = shot.distance
    let elevation = shot.elevation + Math.sin(now * 0.05) * 0.04
    const azimuth = shot.azimuth + Math.sin(now * 0.037) * 0.16

    const f = focus.current
    if (f && now > f.until) focus.current = null
    if (focus.current) {
      const ramp = MathUtils.smoothstep(now - f!.start, 0, 1.4) * (f!.until === Infinity ? 1 : MathUtils.smoothstep(f!.until - now, 0, 1.2))
      const w = f!.weight * ramp
      desiredTarget.lerp(f!.target, w)
      let fd = f!.distance
      if (f!.push) {
        const k = MathUtils.smoothstep(now - f!.start, 0, DEADLOCK_TIMELINE.reveal + 2)
        fd = f!.distance * MathUtils.lerp(1, f!.push, k)
        elevation += k * 0.08
      }
      distance = MathUtils.lerp(distance, fd, w)
    }

    if (follow) {
      desiredTarget.set(follow.pos.x, 0.35, follow.pos.z)
      distance = 5.2
      elevation = 0.5
    }

    // portrait screens see less horizontally: back off to keep the story in frame
    const aspect = size.width / Math.max(1, size.height)
    if (!follow) distance *= MathUtils.clamp(1.3 / aspect, 1, 2.3)

    const intro = (now - introAt.current) / INTRO
    if (intro < 1 && !follow) {
      // authored dolly: from a low close look at the core, out to the scenario's framing
      const p = easeInOutCubic(Math.max(0, intro))
      const az = MathUtils.lerp(azimuth - 0.62, azimuth, p)
      const el = MathUtils.lerp(0.2, elevation, p)
      curDistance.current = MathUtils.lerp(INTRO_DISTANCE, distance, p)
      curTarget.current.copy(INTRO_TARGET).lerp(desiredTarget, p)
      sph(el, az, curDistance.current, camera.position).add(curTarget.current)
      ctl.target.copy(curTarget.current)
      ctl.update()
      return
    }

    const k = 1 - Math.exp(-dt * (follow ? 2.6 : 1.1))
    curTarget.current.lerp(desiredTarget, k)
    curDistance.current = MathUtils.lerp(curDistance.current, distance, k * 0.9)

    sph(elevation, azimuth, curDistance.current, desiredPos).add(curTarget.current)
    camera.position.lerp(desiredPos, k)
    if (fx.shake > 0.01) {
      camera.position.x += (Math.random() - 0.5) * fx.shake * 0.12
      camera.position.y += (Math.random() - 0.5) * fx.shake * 0.08
    }
    ctl.target.copy(curTarget.current)
    ctl.update()
  })

  return (
    <OrbitControls
      ref={controls as never}
      makeDefault
      enableDamping
      dampingFactor={0.08}
      enablePan={false}
      minDistance={3.5}
      maxDistance={40}
      maxPolarAngle={Math.PI * 0.47}
      minPolarAngle={0.12}
      rotateSpeed={0.55}
      zoomSpeed={0.7}
    />
  )
}

function sph(elevation: number, azimuth: number, distance: number, out: Vector3) {
  const c = Math.cos(elevation)
  return out.set(Math.sin(azimuth) * c * distance, Math.sin(elevation) * distance, Math.cos(azimuth) * c * distance)
}
