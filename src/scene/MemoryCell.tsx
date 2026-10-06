import { Html } from '@react-three/drei'
import { useFrame, type ThreeEvent } from '@react-three/fiber'
import { useEffect, useMemo, useRef } from 'react'
import {
  AdditiveBlending,
  BoxGeometry,
  Color,
  EdgesGeometry,
  Group,
  LineBasicMaterial,
  LineSegments,
  MathUtils,
  Mesh,
  MeshBasicMaterial,
} from 'three'
import { PALETTE } from '../entities/palette'
import { session } from '../simulation/session'
import { useColony } from '../store/colonyStore'
import { makeShellMaterial } from './materials'

const SIZE = 0.6

/** Float height of a cell: higher when it sits inside a mutex chamber. */
export function cellHeight(name: string) {
  const m = session.world.memory.get(name)
  if (!m) return 1.35
  const [px, pz] = m.layout.pos
  const caged = [...session.world.mutexes.values()].some(
    (mu) => Math.hypot(mu.layout.pos[0] - px, mu.layout.pos[1] - pz) < 0.5,
  )
  return caged ? 1.95 : 1.35
}

/**
 * A shared variable as a floating cell of memory. Reads draw a beam, writes
 * pulse it. When two unsynchronised writes collide, it tears: the geometry
 * splits into colour ghosts, the value flickers between what it is and what
 * it should have been, and it keeps a scar.
 */
export function MemoryCell({ name }: { name: string }) {
  const model = session.world.memory.get(name)!
  const [px, pz] = model.layout.pos
  const floatY = cellHeight(name)
  const caged = floatY > 1.5
  const setHover = useColony((s) => s.setHover)

  const { edges, ghostA, ghostB, mats } = useMemo(() => {
    const eg = new EdgesGeometry(new BoxGeometry(SIZE, SIZE, SIZE))
    const mk = (c: string, o = 1) =>
      new LineBasicMaterial({ color: new Color(c), toneMapped: false, transparent: o < 1, opacity: o })
    const mats = {
      shell: makeShellMaterial({ base: '#03070a', tint: '#5fd4f0', rim: 0.8, spec: 0.25 }),
      edge: mk('#5fd4f0'),
      ghostA: new LineBasicMaterial({ color: new Color('#ff3d2e').multiplyScalar(2), toneMapped: false, transparent: true, opacity: 0, blending: AdditiveBlending }),
      ghostB: new LineBasicMaterial({ color: new Color('#00add8').multiplyScalar(2), toneMapped: false, transparent: true, opacity: 0, blending: AdditiveBlending }),
      core: new MeshBasicMaterial({ color: new Color('#5fd4f0'), toneMapped: false }),
      column: new MeshBasicMaterial({ color: new Color('#00add8'), toneMapped: false, transparent: true, opacity: 0.18, blending: AdditiveBlending, depthWrite: false }),
      wave: new MeshBasicMaterial({ color: new Color('#5fd4f0'), toneMapped: false, transparent: true, opacity: 0, blending: AdditiveBlending, depthWrite: false }),
      pad: new MeshBasicMaterial({ color: new Color('#5fd4f0'), toneMapped: false }),
    }
    return {
      edges: new LineSegments(eg, mats.edge),
      ghostA: new LineSegments(eg, mats.ghostA),
      ghostB: new LineSegments(eg, mats.ghostB),
      mats,
    }
  }, [])

  const body = useRef<Group>(null)
  const core = useRef<Mesh>(null)
  const wave = useRef<Mesh>(null)
  const valueEl = useRef<HTMLDivElement>(null)
  const pulse = useRef(0)
  const waveT = useRef(1)
  const reveal = useRef(0)
  const lastWrites = useRef(0)
  const raceT = useRef(-1)

  useEffect(
    () =>
      session.bus.subscribe((e) => {
        if (e.type === 'RACE_DETECTED' && e.mem === name) raceT.current = 0
        if (e.type === 'MEMORY_READ' && e.mem === name) pulse.current = Math.max(pulse.current, 0.35)
      }),
    [name],
  )

  useFrame(() => {
    const dt = session.frameDt
    const t = session.clock
    const fx = session.fx
    const m = session.world.memory.get(name)
    if (!m || !body.current) return
    reveal.current = Math.min(1, reveal.current + dt * 1.2)

    if (m.writes !== lastWrites.current) {
      lastWrites.current = m.writes
      pulse.current = 1
      waveT.current = 0
    }
    pulse.current = Math.max(0, pulse.current - dt * 2.2)
    waveT.current = Math.min(1, waveT.current + dt * 1.4)
    if (raceT.current >= 0) raceT.current += dt

    const racing = raceT.current >= 0 && raceT.current < 2.4
    const tear = racing ? fx.glitch : 0
    const scar = m.raced ? 1 : 0

    // body
    const b = body.current
    const bob = Math.sin(t * 1.3) * 0.05 * fx.life
    b.position.set(0, floatY + bob, 0)
    b.rotation.y = t * 0.25 * fx.life + tear * (Math.random() - 0.5) * 0.8
    b.rotation.x = Math.sin(t * 0.5) * 0.08 * fx.life
    const sc = easeOutBack(reveal.current) * (1 + pulse.current * 0.12)
    b.scale.set(sc * (1 + tear * (Math.random() - 0.5) * 0.5), sc * (1 + tear * (Math.random() - 0.5) * 0.3), sc)
    if (tear > 0.05) {
      b.position.x += (Math.random() - 0.5) * tear * 0.25
      b.position.y += (Math.random() - 0.5) * tear * 0.15
    }

    // colour: calm cyan; warm gold for a claimed value; ember scar after a race
    const base = scar ? PALETTE.ember : m.tone === 'warm' ? PALETTE.payload : m.tone === 'hot' ? PALETTE.ember : PALETTE.goSoft
    mats.edge.color.copy(base).multiplyScalar(1.1 + pulse.current * 2.5 + tear * 2)
    mats.core.color.copy(base).multiplyScalar(1.4 + pulse.current * 4 + (scar ? Math.abs(Math.sin(t * 3)) * 1.2 : 0))
    if (core.current) core.current.scale.setScalar(0.16 + pulse.current * 0.08)
    mats.pad.color.copy(base).multiplyScalar(0.9 + pulse.current)
    mats.column.color.copy(base)
    mats.column.opacity = 0.12 + pulse.current * 0.25

    const ghost = Math.max(tear, scar * 0.12)
    mats.ghostA.opacity = ghost
    mats.ghostB.opacity = ghost
    ghostA.position.set(0.05 + tear * 0.12, tear * 0.03, 0)
    ghostB.position.set(-0.05 - tear * 0.12, -tear * 0.03, 0)

    // write wave
    if (wave.current) {
      const w = waveT.current
      wave.current.scale.setScalar(0.4 + w * 1.6)
      mats.wave.opacity = (1 - w) * (1 - w) * 0.9
      mats.wave.color.copy(base)
    }

    // value readout
    const el = valueEl.current
    if (el) {
      const race = session.world.race
      let shown = String(m.value)
      if (racing && race && race.mem === name && Math.random() < 0.55) shown = String(Math.random() < 0.5 ? race.expected : race.value)
      const valNode = el.querySelector('[data-v]')!
      if (valNode.textContent !== shown) valNode.textContent = shown
      el.dataset.state = scar ? 'hot' : pulse.current > 0.5 ? 'pulse' : ''
      el.dataset.tone = m.tone ?? ''
      const want = el.querySelector('[data-want]')!
      const wantText = scar && race ? `want ${race.expected}` : ''
      if (want.textContent !== wantText) want.textContent = wantText
    }
  })

  const hover = (e: ThreeEvent<PointerEvent>) => {
    e.stopPropagation()
    setHover({ kind: 'memory', id: name })
  }

  return (
    <group position={[px, 0, pz]}>
      <group ref={body}>
        <mesh material={mats.shell} onPointerMove={hover} onPointerOut={() => setHover(null)}>
          <boxGeometry args={[SIZE * 0.98, SIZE * 0.98, SIZE * 0.98]} />
        </mesh>
        <primitive object={edges} />
        <primitive object={ghostA} />
        <primitive object={ghostB} />
        <mesh ref={core} material={mats.core}>
          <octahedronGeometry args={[1, 0]} />
        </mesh>
      </group>

      <mesh position-y={floatY / 2} material={mats.column}>
        <cylinderGeometry args={[0.012, 0.012, floatY, 6, 1, true]} />
      </mesh>
      {!caged && (
        <mesh position-y={0.02} rotation-x={-Math.PI / 2} material={mats.pad}>
          <ringGeometry args={[0.55, 0.58, 4, 1, Math.PI / 4]} />
        </mesh>
      )}
      <mesh ref={wave} position-y={floatY} rotation-x={-Math.PI / 2} material={mats.wave}>
        <ringGeometry args={[0.5, 0.53, 48]} />
      </mesh>

      <Html
        position={model.group ? [0, floatY - 0.62, 0] : [0.62, floatY + 0.05, 0]}
        zIndexRange={[10, 0]}
        style={{ pointerEvents: 'none' }}
      >
        <div ref={valueEl} className={model.group ? 'mem-label mem-label-grid' : 'mem-label'}>
          <span className="ml-name">{model.label}</span>
          <span className={typeof model.value === 'string' ? 'ml-value ml-text' : 'ml-value'} data-v>
            {model.value}
          </span>
          <span className="ml-want" data-want />
        </div>
      </Html>
    </group>
  )
}

const easeOutBack = (x: number) => {
  const c1 = 1.70158
  const c3 = c1 + 1
  return MathUtils.clamp(1 + c3 * Math.pow(x - 1, 3) + c1 * Math.pow(x - 1, 2), 0, 2)
}
