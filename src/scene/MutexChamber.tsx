import { Html } from '@react-three/drei'
import { useFrame, type ThreeEvent } from '@react-three/fiber'
import { useMemo, useRef } from 'react'
import {
  BoxGeometry,
  Color,
  Group,
  InstancedBufferAttribute,
  InstancedMesh,
  MathUtils,
  Matrix4,
  MeshBasicMaterial,
  Quaternion,
  Vector3,
} from 'three'
import { PALETTE } from '../entities/palette'
import { CHAMBER_RADIUS, gateDir } from '../simulation/layout'
import { session } from '../simulation/session'
import { useColony } from '../store/colonyStore'
import { makeShellMaterial } from './materials'
import { creatures } from './registry'

const BARS = 28
const GATE_HALF = 0.36 // radians either side of the gate direction
const BAR_H = 0.95

const m4 = new Matrix4()
const q = new Quaternion()
const v = new Vector3()
const s = new Vector3()
const col = new Color()

/**
 * sync.Mutex as a caged chamber. One goroutine inside; the gate bars rise
 * behind it. Contenders pile up outside the gate, pressing against the bars.
 * The padlock above the gate shows the state: open shackle = free.
 */
export function MutexChamber({ name }: { name: string }) {
  const mu = session.world.mutexes.get(name)!
  const [px, pz] = mu.layout.pos
  const gateAngle = mu.layout.gate
  const [gx, gz] = gateDir(mu.layout)
  const setHover = useColony((st) => st.setHover)

  const bars = useMemo(() => {
    const mesh = new InstancedMesh(new BoxGeometry(0.045, 1, 0.045).translate(0, 0.5, 0), makeShellMaterial({ base: '#0d141a', rim: 1.4 }), BARS)
    mesh.instanceColor = new InstancedBufferAttribute(new Float32Array(BARS * 3), 3)
    return mesh
  }, [])
  const isGate = useMemo(
    () =>
      Array.from({ length: BARS }, (_, i) => {
        const a = (i / BARS) * Math.PI * 2
        const d = Math.atan2(Math.sin(a - gateAngle), Math.cos(a - gateAngle))
        return Math.abs(d) < GATE_HALF
      }),
    [gateAngle],
  )

  const mats = useMemo(
    () => ({
      ring: new MeshBasicMaterial({ color: new Color('#00add8'), toneMapped: false }),
      top: new MeshBasicMaterial({ color: new Color('#00add8'), toneMapped: false }),
      lock: new MeshBasicMaterial({ color: new Color('#00add8'), toneMapped: false }),
      floor: makeShellMaterial({ base: '#080d12', tint: '#00add8', rim: 0.6, spec: 0.2 }),
      plate: new MeshBasicMaterial({ color: new Color('#00add8'), toneMapped: false, transparent: true, opacity: 0.12, depthWrite: false }),
    }),
    [],
  )

  const shackle = useRef<Group>(null)
  const lockGroup = useRef<Group>(null)
  const label = useRef<HTMLDivElement>(null)
  const gate = useRef(1) // 1 = open
  const reveal = useRef(0)
  const lastOwner = useRef<number | null>(null)
  const clank = useRef(0)

  useFrame(() => {
    const dt = session.frameDt
    const t = session.clock
    const world = session.world
    const model = world.mutexes.get(name)
    if (!model) return
    reveal.current = Math.min(1, reveal.current + dt * 1.1)
    const waiters = world.queue(name, 'sync.Mutex.Lock')
    const owner = model.owner

    if (owner !== lastOwner.current) {
      if (owner != null) clank.current = 1
      lastOwner.current = owner
    }
    clank.current = Math.max(0, clank.current - dt * 2.5)

    // gate opens for a free lock, or to let the owner pass in or out
    let open = owner == null
    if (owner != null) {
      const c = creatures.get(owner)
      if (c) {
        const gateX = px + gx * CHAMBER_RADIUS
        const gateZ = pz + gz * CHAMBER_RADIUS
        if (Math.hypot(c.pos.x - gateX, c.pos.z - gateZ) < 0.95) open = true
      }
    }
    gate.current = MathUtils.damp(gate.current, open ? 1 : 0, open ? 7 : 5, dt)

    const locked = owner != null
    const contended = waiters.length > 0
    const stateCol = contended ? PALETTE.ember : locked ? PALETTE.amber : PALETTE.go
    const k = 1 - Math.exp(-dt * 6)
    mats.ring.color.lerp(col.copy(stateCol).multiplyScalar(1.4 + clank.current * 2), k)
    mats.top.color.lerp(col.copy(stateCol).multiplyScalar(0.9), k)
    mats.lock.color.lerp(col.copy(stateCol).multiplyScalar(2 + clank.current * 3), k)
    mats.plate.color.lerp(stateCol, k)
    mats.plate.opacity = 0.05 + (locked ? 0.08 : 0.02)

    const grow = easeOut(reveal.current)
    for (let i = 0; i < BARS; i++) {
      const a = (i / BARS) * Math.PI * 2
      const stagger = MathUtils.clamp(grow * 1.6 - (i / BARS) * 0.6, 0, 1)
      let h = BAR_H * stagger
      if (isGate[i]) h *= 1 - gate.current * 0.94
      v.set(Math.sin(a) * CHAMBER_RADIUS, 0, Math.cos(a) * CHAMBER_RADIUS)
      q.identity()
      m4.compose(v, q, s.set(1, Math.max(0.001, h), 1))
      bars.setMatrixAt(i, m4)
      bars.setColorAt(i, col.copy(isGate[i] ? stateCol : PALETTE.go).multiplyScalar(isGate[i] ? 1.2 : 0.45))
    }
    bars.instanceMatrix.needsUpdate = true
    bars.instanceColor!.needsUpdate = true

    // padlock: shackle lifts when free, drops when locked
    if (shackle.current) shackle.current.position.y = MathUtils.damp(shackle.current.position.y, locked ? 0 : 0.09, 10, dt)
    if (lockGroup.current) {
      lockGroup.current.position.y = 1.3 + Math.sin(t * 1.4) * 0.03 * session.fx.life - clank.current * 0.06
      lockGroup.current.rotation.y = gateAngle + Math.sin(t * 0.7) * 0.15 * session.fx.life
      lockGroup.current.scale.setScalar(grow)
    }

    if (label.current) {
      const who = owner != null ? (world.goroutines.get(owner)?.label ?? `g${owner}`) : ''
      const text = locked ? `locked by ${who}${contended ? ` · ${waiters.length} waiting` : ''}` : 'unlocked'
      const el = label.current.querySelector('[data-state-text]')
      if (el && el.textContent !== text) el.textContent = text
      label.current.dataset.state = contended ? 'hot' : locked ? 'warm' : ''
    }
  })

  const hover = (e: ThreeEvent<PointerEvent>) => {
    e.stopPropagation()
    setHover({ kind: 'mutex', id: name })
  }

  const gatePos: [number, number, number] = [gx * (CHAMBER_RADIUS + 0.02), 0, gz * (CHAMBER_RADIUS + 0.02)]

  return (
    <group position={[px, 0, pz]}>
      <mesh position-y={0.02} material={mats.floor} onPointerMove={hover} onPointerOut={() => setHover(null)}>
        <cylinderGeometry args={[CHAMBER_RADIUS + 0.12, CHAMBER_RADIUS + 0.2, 0.04, 64]} />
      </mesh>
      <mesh position-y={0.043} rotation-x={-Math.PI / 2} material={mats.plate}>
        <circleGeometry args={[CHAMBER_RADIUS - 0.05, 48]} />
      </mesh>
      <mesh position-y={0.045} rotation-x={-Math.PI / 2} material={mats.ring}>
        <ringGeometry args={[CHAMBER_RADIUS - 0.06, CHAMBER_RADIUS - 0.02, 96]} />
      </mesh>
      <mesh position-y={0.045} rotation-x={-Math.PI / 2} material={mats.ring}>
        <ringGeometry args={[0.32, 0.34, 48]} />
      </mesh>
      <primitive object={bars} />
      {/* top rail, open over the gate */}
      <group rotation-y={gateAngle - Math.PI / 2 - GATE_HALF}>
        <mesh position-y={BAR_H} rotation-x={Math.PI / 2} material={mats.top}>
          <torusGeometry args={[CHAMBER_RADIUS, 0.012, 6, 96, Math.PI * 2 - GATE_HALF * 2]} />
        </mesh>
      </group>

      {/* padlock over the gate */}
      <group position={gatePos}>
        <group ref={lockGroup}>
          <mesh material={mats.lock}>
            <boxGeometry args={[0.2, 0.15, 0.06]} />
          </mesh>
          <group ref={shackle}>
            <mesh position-y={0.075} material={mats.lock}>
              <torusGeometry args={[0.065, 0.014, 6, 24, Math.PI]} />
            </mesh>
            <mesh position={[-0.065, 0.06, 0]} material={mats.lock}>
              <boxGeometry args={[0.028, 0.06, 0.028]} />
            </mesh>
            <mesh position={[0.065, 0.06, 0]} material={mats.lock}>
              <boxGeometry args={[0.028, 0.06, 0.028]} />
            </mesh>
          </group>
        </group>
      </group>

      <Html position={[0, 0.05, CHAMBER_RADIUS + 0.55]} center zIndexRange={[10, 0]} style={{ pointerEvents: 'none' }}>
        <div ref={label} className="world-label">
          <span className="wl-name">{name}</span>
          <span className="wl-type">sync.Mutex</span>
          <span className="wl-buf" data-state-text>
            unlocked
          </span>
        </div>
      </Html>
    </group>
  )
}

const easeOut = (x: number) => 1 - Math.pow(1 - x, 3)
