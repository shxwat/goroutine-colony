import { useFrame } from '@react-three/fiber'
import { useEffect, useMemo } from 'react'
import {
  AdditiveBlending,
  Color,
  CylinderGeometry,
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
import { cellHeight } from './MemoryCell'
import { creatures } from './registry'

const SEGS = 22
const MAX_LINKS = 20

type End = { gid: number } | { mutex: string } | { cell: string }

interface Beam {
  from: End
  to: End
  color: Color
  born: number
  life: number
  width: number
  /** Seconds to draw the line from source to target. */
  grow: number
  flow: number
  boost?: number
}

const UP = new Vector3(0, 1, 0)
const m4 = new Matrix4()
const q = new Quaternion()
const sc = new Vector3()
const a = new Vector3()
const b = new Vector3()
const mid = new Vector3()
const p0 = new Vector3()
const p1 = new Vector3()
const dir = new Vector3()
const col = new Color()

function endPos(e: End, out: Vector3): boolean {
  const world = session.world
  if ('gid' in e) {
    const c = creatures.get(e.gid)
    if (!c) return false
    c.local(0, 0.16 * c.size, 0.05, out)
    return true
  }
  if ('mutex' in e) {
    const mu = world.mutexes.get(e.mutex)
    if (!mu) return false
    const [gx, gz] = gateDir(mu.layout)
    out.set(mu.layout.pos[0] + gx * CHAMBER_RADIUS, 1.24, mu.layout.pos[1] + gz * CHAMBER_RADIUS)
    return true
  }
  const m = world.memory.get(e.cell)
  if (!m) return false
  out.set(m.layout.pos[0], cellHeight(e.cell) - 0.25, m.layout.pos[1])
  return true
}

function bez(t: number, out: Vector3) {
  const u = 1 - t
  return out.set(0, 0, 0).addScaledVector(a, u * u).addScaledVector(mid, 2 * u * t).addScaledVector(b, t * t)
}

/**
 * Relationships drawn as light:
 *  - ownership tethers from a goroutine to the lock it holds (when it is not inside)
 *  - transient read/write beams between goroutines and memory
 *  - on deadlock, the wait-for edges that close the cycle
 */
export function Links() {
  const mesh = useMemo(() => {
    const m = new InstancedMesh(
      new CylinderGeometry(1, 1, 1, 5, 1, true).translate(0, 0.5, 0),
      new MeshBasicMaterial({ toneMapped: false, transparent: true, blending: AdditiveBlending, depthWrite: false }),
      MAX_LINKS * SEGS,
    )
    m.instanceColor = new InstancedBufferAttribute(new Float32Array(MAX_LINKS * SEGS * 3), 3)
    m.frustumCulled = false
    m.count = 0
    return m
  }, [])
  const beams = useMemo<Beam[]>(() => [], [])

  useEffect(
    () =>
      session.bus.subscribe((e) => {
        const now = session.clock
        const add = (bm: Omit<Beam, 'born'>) => {
          beams.push({ ...bm, born: now })
          if (beams.length > MAX_LINKS) beams.shift()
        }
        if (e.type === 'MEMORY_READ')
          add({ from: { cell: e.mem }, to: { gid: e.gid }, color: PALETTE.goSoft, life: 0.7, width: 0.012, grow: 0.2, flow: 1 })
        if (e.type === 'MEMORY_WRITE')
          add({ from: { gid: e.gid }, to: { cell: e.mem }, color: PALETTE.bone, life: 0.8, width: 0.016, grow: 0.15, flow: 1 })
        if (e.type === 'RACE_DETECTED') {
          add({ from: { gid: e.gids[0] }, to: { cell: e.mem }, color: PALETTE.ember, life: 3.2, width: 0.03, grow: 0.08, flow: 3 })
          add({ from: { gid: e.gids[1] }, to: { cell: e.mem }, color: PALETTE.go, life: 3.2, width: 0.03, grow: 0.08, flow: 3 })
        }
        if (e.type === 'DEADLOCK_DETECTED') {
          for (const edge of e.cycle) {
            add({ from: { gid: edge.gid }, to: { mutex: edge.waitsFor }, color: PALETTE.ember, life: Infinity, width: 0.024, grow: 1.6, flow: 1, boost: 2.2 })
          }
        }
      }),
    [beams],
  )

  useFrame(() => {
    const now = session.clock
    const life = session.fx.life
    const world = session.world
    let n = 0

    const draw = (from: End, to: End, color: Color, alpha: number, width: number, reach: number, flow: number) => {
      if (!endPos(from, a) || !endPos(to, b)) return
      const d = a.distanceTo(b)
      mid.lerpVectors(a, b, 0.5)
      mid.y += 0.25 + d * 0.22
      for (let i = 0; i < SEGS && n < MAX_LINKS * SEGS; i++) {
        const t0 = i / SEGS
        const t1 = (i + 1) / SEGS
        if (t0 >= reach) break
        bez(t0, p0)
        bez(Math.min(t1, reach), p1)
        dir.subVectors(p1, p0)
        const len = dir.length() || 1e-4
        q.setFromUnitVectors(UP, dir.multiplyScalar(1 / len))
        m4.compose(p0, q, sc.set(width, len, width))
        mesh.setMatrixAt(n, m4)
        const wave = 0.55 + 0.45 * Math.sin(t0 * 14 - now * 5 * flow * Math.max(life, 0.15))
        mesh.setColorAt(n, col.copy(color).multiplyScalar(alpha * wave * 1.8))
        n++
      }
    }

    // ownership tethers: a goroutine holding a lock while standing outside it
    const deadlocked = world.deadlock != null
    for (const mu of world.mutexes.values()) {
      if (mu.owner == null) continue
      const c = creatures.get(mu.owner)
      if (!c) continue
      const out = Math.hypot(c.pos.x - mu.layout.pos[0], c.pos.z - mu.layout.pos[1]) - CHAMBER_RADIUS
      const k = MathUtils.smoothstep(out, -0.4, 0.6)
      if (k <= 0.01) continue
      const color = deadlocked ? PALETTE.ember : PALETTE.amber
      draw({ mutex: mu.name }, { gid: mu.owner }, color, k * (deadlocked ? 2.2 : 0.7), deadlocked ? 0.02 : 0.014, 1, 0.6)
    }

    // transient beams
    for (let i = beams.length - 1; i >= 0; i--) {
      const bm = beams[i]
      const age = now - bm.born
      if (age > bm.life) {
        beams.splice(i, 1)
        continue
      }
      const fadeIn = MathUtils.smoothstep(age, 0, Math.min(0.2, bm.grow))
      const fadeOut = bm.life === Infinity ? 1 : 1 - MathUtils.smoothstep(age, bm.life * 0.6, bm.life)
      const reach = MathUtils.clamp(age / bm.grow, 0, 1)
      const flicker = bm.flow > 2 ? (Math.random() < 0.3 ? 0.4 : 1) : 1
      draw(bm.from, bm.to, bm.color, fadeIn * fadeOut * flicker * (bm.boost ?? 1), bm.width, reach, bm.flow)
    }

    mesh.count = n
    mesh.instanceMatrix.needsUpdate = true
    mesh.instanceColor!.needsUpdate = true
  })

  return <primitive object={mesh} />
}
