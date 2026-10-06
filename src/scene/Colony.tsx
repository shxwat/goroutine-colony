import { useFrame, type ThreeEvent } from '@react-three/fiber'
import { useEffect, useMemo } from 'react'
import {
  Color,
  CylinderGeometry,
  InstancedBufferAttribute,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  PlaneGeometry,
  Quaternion,
  RingGeometry,
  SphereGeometry,
  Vector3,
  type BufferGeometry,
  type Material,
} from 'three'
import { Creature } from '../entities/creature'
import { PALETTE } from '../entities/palette'
import { MAIN_HOME, SPAWN_POS } from '../simulation/layout'
import { session } from '../simulation/session'
import { useColony } from '../store/colonyStore'
import { makePoolMaterial, makeShellMaterial } from './materials'
import { creatures } from './registry'
import { resolveIntent, type Intent } from './targets'

const MAX = 64
const LEG_SEGS = 6 * 2 + 2 // six two-bone legs + two antennae

const UP = new Vector3(0, 1, 0)
const m4 = new Matrix4()
const q = new Quaternion()
const q2 = new Quaternion()
const sc = new Vector3()
const p = new Vector3()
const dir = new Vector3()
const col = new Color()
const col2 = new Color()
const LEG_BASE = new Color('#1e2a34')
const OUTCOME_COLOR = { success: PALETTE.payload, rejected: PALETTE.ember, error: PALETTE.violet }

function instanced(geo: BufferGeometry, mat: Material, count: number) {
  const mesh = new InstancedMesh(geo, mat, count)
  mesh.instanceColor = new InstancedBufferAttribute(new Float32Array(count * 3), 3)
  mesh.frustumCulled = false
  mesh.count = 0
  return mesh
}

function segment(mesh: InstancedMesh, i: number, a: Vector3, b: Vector3, r: number) {
  dir.subVectors(b, a)
  const len = dir.length() || 1e-4
  q.setFromUnitVectors(UP, dir.multiplyScalar(1 / len))
  sc.set(r, len, r)
  m4.compose(a, q, sc)
  mesh.setMatrixAt(i, m4)
}

const easeOutBack = (x: number) => {
  const c1 = 1.70158
  const c3 = c1 + 1
  return 1 + c3 * Math.pow(x - 1, 3) + c1 * Math.pow(x - 1, 2)
}

export function Colony() {
  const meshes = useMemo(() => {
    const legGeo = new CylinderGeometry(1, 1, 1, 5, 1, true).translate(0, 0.5, 0)
    const pool = new PlaneGeometry(1, 1).rotateX(-Math.PI / 2)
    return {
      shells: instanced(new SphereGeometry(1, 18, 12), makeShellMaterial({ base: '#080d12', rim: 2.3, spec: 0.12 }), MAX * 3),
      glows: instanced(new SphereGeometry(1, 10, 8), new MeshBasicMaterial({ toneMapped: false }), MAX * 2),
      legs: instanced(legGeo, new MeshBasicMaterial({ toneMapped: false }), MAX * LEG_SEGS),
      joints: instanced(new SphereGeometry(1, 6, 4), new MeshBasicMaterial({ toneMapped: false }), MAX * 12),
      pools: instanced(pool, makePoolMaterial(), MAX),
      picks: instanced(new SphereGeometry(1, 8, 6), new MeshBasicMaterial({ visible: false }), MAX),
    }
  }, [])

  const ring = useMemo(() => {
    const m = new Mesh(new RingGeometry(0.42, 0.45, 48).rotateX(-Math.PI / 2), new MeshBasicMaterial({ toneMapped: false, transparent: true, depthWrite: false }))
    m.visible = false
    return m
  }, [])
  const order = useMemo<number[]>(() => [], [])
  const intents = useMemo(() => new Map<number, Intent>(), [])
  const journeys = useMemo(() => new Map<number, { seq: number; pace: number }>(), [])
  const retired = useMemo(() => new Set<number>(), [])

  useEffect(() => {
    creatures.clear()
    return () => {
      creatures.clear()
      for (const m of Object.values(meshes)) {
        m.geometry.dispose()
        ;(m.material as Material).dispose()
      }
    }
  }, [meshes])

  useFrame(() => {
    const world = session.world
    const dt = session.frameDt
    const t = session.clock
    const life = session.fx.life

    // births
    for (const g of world.goroutines.values()) {
      if (creatures.has(g.gid) || retired.has(g.gid)) continue
      const home = g.anchor === 'main' ? MAIN_HOME : SPAWN_POS
      const c = new Creature(g.gid, p.set(home[0], 0, home[2]), 0, g.fn === 'main.main' ? 1.35 : 1)
      if (g.anchor === 'main') c.appear = 0.2
      creatures.set(g.gid, c)
      intents.set(g.gid, { target: new Vector3(), face: null, straining: false })
    }

    const { shells, glows, legs, joints, pools, picks } = meshes
    order.length = 0
    let n = 0
    for (const c of creatures.values()) {
      const g = world.goroutines.get(c.gid)
      if (!g) continue
      const intent = resolveIntent(world, g, intents.get(c.gid)!)
      // keep pace with journeys a live director has timed
      let j = journeys.get(c.gid)
      if (!j || j.seq !== g.moveSeq) {
        const d = Math.hypot(intent.target.x - c.pos.x, intent.target.z - c.pos.z)
        j = { seq: g.moveSeq, pace: g.moveDuration > 0 ? d / g.moveDuration : 0 }
        journeys.set(c.gid, j)
      }
      const outcome = g.outcome ? OUTCOME_COLOR[g.outcome] : null
      c.update(dt, t, life, { state: g.state, ...intent, pace: j.pace, outcome }, creatures.values())
      if (c.dissolve >= 1) {
        creatures.delete(c.gid)
        retired.add(c.gid)
        continue
      }
      if (n >= MAX) continue
      writeCreature(c, n)
      order.push(c.gid)
      n++
    }

    shells.count = n * 3
    glows.count = n * 2
    legs.count = n * LEG_SEGS
    joints.count = n * 12
    pools.count = n
    picks.count = n
    for (const m of Object.values(meshes)) {
      m.instanceMatrix.needsUpdate = true
      if (m.instanceColor) m.instanceColor.needsUpdate = true
    }
    picks.boundingSphere = null

    // selection ring under the followed goroutine
    const sel = useColony.getState().selected
    const sc = sel != null ? creatures.get(sel) : undefined
    ring.visible = !!sc
    if (sc) {
      ring.position.set(sc.pos.x, 0.02, sc.pos.z)
      ring.scale.setScalar(sc.size * (1 + Math.sin(t * 4) * 0.06))
      ;(ring.material as MeshBasicMaterial).color.copy(sc.color).multiplyScalar(1.8)
      ;(ring.material as MeshBasicMaterial).opacity = 0.9
    }
  })

  function writeCreature(c: Creature, i: number) {
    const { shells, glows, legs, joints, pools, picks } = meshes
    const s = c.size * easeOutBack(c.appear) * (1 - c.dissolve * 0.35)
    const fade = 1 - c.dissolve

    // carapace: thorax, abdomen, head
    const parts: [number, number, number, number, number, number, number][] = [
      // x, y, z, sx, sy, sz, extraPitch
      [0, 0.0, 0.07, 0.12, 0.085, 0.15, 0],
      [0, 0.02, -0.2, 0.15, 0.105, 0.23, 0.16],
      [0, 0.03, 0.27, 0.075, 0.065, 0.085, -0.1],
    ]
    parts.forEach(([x, y, z, sx, sy, sz, pitch], k) => {
      c.local(x * c.size, y * c.size, z * c.size, p)
      q2.setFromAxisAngle(sc.set(1, 0, 0), pitch)
      q.copy(c.quat).multiply(q2)
      m4.compose(p, q, sc.set(sx * s, sy * s, sz * s))
      shells.setMatrixAt(i * 3 + k, m4)
      col.copy(c.color).multiplyScalar(0.25 + 0.75 * fade)
      shells.setColorAt(i * 3 + k, col)
    })

    // dorsal light strip + eye
    c.local(0, 0.1 * c.size, -0.17 * c.size, p)
    q2.setFromAxisAngle(sc.set(1, 0, 0), 0.16)
    q.copy(c.quat).multiply(q2)
    m4.compose(p, q, sc.set(0.028 * s, 0.024 * s, 0.21 * s))
    glows.setMatrixAt(i * 2, m4)
    col.copy(c.color).multiplyScalar(2.6 * c.glow * fade)
    glows.setColorAt(i * 2, col)

    c.local(0, 0.035 * c.size, 0.345 * c.size, p)
    m4.compose(p, c.quat, sc.set(0.03 * s, 0.022 * s, 0.02 * s))
    glows.setMatrixAt(i * 2 + 1, m4)
    col.copy(c.color).multiplyScalar(3.2 * c.glow * fade + 0.2)
    glows.setColorAt(i * 2 + 1, col)

    // legs
    const r = 0.012 * s
    col.copy(LEG_BASE).lerp(c.color, 0.32).multiplyScalar(0.6 + 0.6 * fade)
    let k = i * LEG_SEGS
    let j = i * 12
    for (const leg of c.legs) {
      segment(legs, k, leg.hipW, leg.kneeW, r * 1.25)
      legs.setColorAt(k++, col)
      segment(legs, k, leg.kneeW, leg.foot, r)
      legs.setColorAt(k++, col)
      m4.compose(leg.kneeW, q.identity(), sc.setScalar(0.02 * s))
      joints.setMatrixAt(j, m4)
      joints.setColorAt(j++, col)
      m4.compose(leg.foot, q.identity(), sc.setScalar(0.018 * s))
      joints.setMatrixAt(j, m4)
      joints.setColorAt(j++, col2.copy(c.color).multiplyScalar(1.4 * c.glow * fade))
    }
    col.copy(c.color).multiplyScalar(0.9 * c.glow * fade)
    for (let a = 0; a < 2; a++) {
      segment(legs, k, c.antennaBase[a], c.antennae[a], r * 0.6)
      legs.setColorAt(k++, col)
    }

    // light pool on the floor
    p.set(c.pos.x, 0.012, c.pos.z)
    const ps = (1.5 + c.glow * 0.5) * c.size * s
    m4.compose(p, q.identity(), sc.set(ps, 1, ps))
    pools.setMatrixAt(i, m4)
    col.copy(c.color).multiplyScalar(0.22 * c.glow * fade)
    pools.setColorAt(i, col)

    // invisible picking volume
    p.set(c.pos.x, c.bodyY, c.pos.z)
    m4.compose(p, q.identity(), sc.setScalar(0.42 * c.size))
    picks.setMatrixAt(i, m4)
  }

  const setHover = useColony((s) => s.setHover)
  const select = useColony((s) => s.select)

  const gidAt = (e: ThreeEvent<PointerEvent | MouseEvent>) =>
    e.instanceId != null ? order[e.instanceId] ?? null : null

  return (
    <group>
      <primitive object={meshes.pools} renderOrder={-1} />
      <primitive object={ring} />
      <primitive object={meshes.shells} />
      <primitive object={meshes.glows} />
      <primitive object={meshes.legs} />
      <primitive object={meshes.joints} />
      <primitive
        object={meshes.picks}
        onPointerMove={(e: ThreeEvent<PointerEvent>) => {
          e.stopPropagation()
          const gid = gidAt(e)
          if (gid != null) setHover({ kind: 'goroutine', id: gid })
        }}
        onPointerOut={() => setHover(null)}
        onClick={(e: ThreeEvent<MouseEvent>) => {
          e.stopPropagation()
          const gid = gidAt(e)
          if (gid != null) select(gid)
        }}
      />
    </group>
  )
}
