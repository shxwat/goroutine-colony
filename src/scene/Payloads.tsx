import { useFrame } from '@react-three/fiber'
import { useEffect, useMemo } from 'react'
import {
  Color,
  InstancedBufferAttribute,
  InstancedMesh,
  Matrix4,
  MeshBasicMaterial,
  OctahedronGeometry,
  Quaternion,
  Vector3,
  Euler,
} from 'three'
import { PALETTE } from '../entities/palette'
import { channelFrame, slotU } from '../simulation/layout'
import { session } from '../simulation/session'
import type { PayloadModel } from '../simulation/world'
import { ConduitCurve, conduitPulses } from './curves'
import { emitBurst } from './fx/particles'
import { creatures } from './registry'

const MAX = 48
const TUBE_SPEED = 8.5 // world units per second inside a conduit
const HOP = 0.32 // seconds to hop in/out of a port

type Mode = 'carried' | 'enter' | 'tube' | 'exit' | 'consume' | 'dead'

interface Visual {
  pid: number
  seen: number
  mode: Mode
  pos: Vector3
  from: Vector3
  t: number
  carrier: number | null
  dest: number | null
  ch: string | null
  u: number
  scale: number
  spin: number
}

const m4 = new Matrix4()
const q = new Quaternion()
const e = new Euler()
const s = new Vector3()
const tmp = new Vector3()
const tmp2 = new Vector3()
const col = new Color()
const curves = new Map<string, { curve: ConduitCurve; length: number }>()

function conduit(name: string) {
  const ch = session.world.channels.get(name)
  if (!ch) return null
  let c = curves.get(name)
  if (!c) {
    const f = channelFrame(ch.layout)
    c = { curve: new ConduitCurve(f), length: f.length * 1.08 }
    curves.set(name, c)
  }
  return c
}

/** Arc from a to b: payloads hop rather than slide. */
function hop(a: Vector3, b: Vector3, t: number, height: number, out: Vector3) {
  const k = t * t * (3 - 2 * t)
  out.lerpVectors(a, b, k)
  out.y += Math.sin(Math.PI * t) * height
  return out
}

/**
 * Values travelling between goroutines. A payload rides on its sender's back,
 * hops into the send port, slides through the conduit to its slot (or straight
 * through to a waiting receiver), and is finally absorbed by whoever processes it.
 */
export function Payloads() {
  const { cores, cages } = useMemo(() => {
    const cores = new InstancedMesh(new OctahedronGeometry(0.075, 0), new MeshBasicMaterial({ toneMapped: false }), MAX)
    cores.instanceColor = new InstancedBufferAttribute(new Float32Array(MAX * 3), 3)
    const cages = new InstancedMesh(new OctahedronGeometry(0.135, 0), new MeshBasicMaterial({ toneMapped: false, wireframe: true }), MAX)
    cages.instanceColor = new InstancedBufferAttribute(new Float32Array(MAX * 3), 3)
    for (const m of [cores, cages]) {
      m.frustumCulled = false
      m.count = 0
    }
    return { cores, cages }
  }, [])
  const visuals = useMemo(() => new Map<number, Visual>(), [])

  useEffect(() => {
    curves.clear()
    conduitPulses.clear()
    return () => {
      curves.clear()
      conduitPulses.clear()
    }
  }, [])

  useFrame(() => {
    const world = session.world
    const dt = session.frameDt
    const t = session.clock
    conduitPulses.clear()

    for (const p of world.payloads.values()) {
      let v = visuals.get(p.pid)
      if (!v) {
        v = {
          pid: p.pid, seen: -1, mode: 'carried', pos: new Vector3(), from: new Vector3(), t: 0,
          carrier: p.loc.k === 'g' ? p.loc.gid : null, dest: null, ch: null, u: 0, scale: 0, spin: Math.random() * 6,
        }
        const c = v.carrier != null ? creatures.get(v.carrier) : null
        if (c) c.carryPoint(v.pos, t)
        visuals.set(p.pid, v)
      }
      if (v.seen !== p.moveSeq) transition(v, p)
      step(v, p, dt, t)
    }

    let n = 0
    for (const v of visuals.values()) {
      if (v.mode === 'dead' || n >= MAX) continue
      v.spin += dt * (v.mode === 'tube' ? 5 : 1.5)
      e.set(v.spin * 0.7, v.spin, 0)
      q.setFromEuler(e)
      m4.compose(v.pos, q, s.setScalar(v.scale))
      cores.setMatrixAt(n, m4)
      e.set(-v.spin * 0.4, -v.spin * 0.6, v.spin * 0.3)
      q.setFromEuler(e)
      m4.compose(v.pos, q, s.setScalar(v.scale))
      cages.setMatrixAt(n, m4)
      const heat = v.mode === 'tube' ? 1.4 : 1
      cores.setColorAt(n, col.copy(PALETTE.payload).multiplyScalar(2.6 * heat))
      cages.setColorAt(n, col.copy(PALETTE.payload).multiplyScalar(0.9 * heat))
      n++
    }
    cores.count = n
    cages.count = n
    cores.instanceMatrix.needsUpdate = true
    cages.instanceMatrix.needsUpdate = true
    cores.instanceColor!.needsUpdate = true
    cages.instanceColor!.needsUpdate = true
  })

  function transition(v: Visual, p: PayloadModel) {
    v.seen = p.moveSeq
    const loc = p.loc
    if (loc.k === 'gone') {
      v.mode = 'consume'
      v.t = 0
      v.from.copy(v.pos)
      return
    }
    if (loc.k === 'slot') {
      v.ch = loc.ch
      v.dest = null
      if (v.mode === 'carried') beginEnter(v)
      return
    }
    // into a goroutine's hands
    if (p.via && v.mode === 'carried' && v.carrier !== loc.gid) {
      // direct hand-off through a conduit
      v.ch = p.via
      v.dest = loc.gid
      beginEnter(v)
    } else if (v.mode === 'tube' || v.mode === 'enter') {
      v.dest = loc.gid
    } else {
      v.carrier = loc.gid
      v.mode = 'carried'
    }
  }

  function beginEnter(v: Visual) {
    v.mode = 'enter'
    v.t = 0
    v.from.copy(v.pos)
  }

  function step(v: Visual, p: PayloadModel, dt: number, t: number) {
    const appear = v.mode === 'consume' ? 0 : 1
    v.scale += (appear - v.scale) * (1 - Math.exp(-dt * (v.mode === 'consume' ? 5 : 7)))

    switch (v.mode) {
      case 'carried': {
        const c = v.carrier != null ? creatures.get(v.carrier) : null
        if (c) {
          c.carryPoint(tmp, t)
          v.pos.lerp(tmp, 1 - Math.exp(-dt * 18))
        }
        break
      }
      case 'enter': {
        const c = v.ch ? conduit(v.ch) : null
        if (!c) break
        v.t = Math.min(1, v.t + dt / HOP)
        c.curve.getPoint(0, tmp2)
        hop(v.from, tmp2, v.t, 0.25, v.pos)
        if (v.t >= 1) {
          v.mode = 'tube'
          v.u = 0
        }
        break
      }
      case 'tube': {
        const c = v.ch ? conduit(v.ch) : null
        if (!c) break
        const model = session.world.channels.get(v.ch!)!
        const idx = model.buffer.indexOf(p.pid)
        const target = v.dest != null ? 1 : idx >= 0 ? slotU(idx, model.cap) : v.u
        const du = target - v.u
        const maxStep = (dt * TUBE_SPEED) / c.length
        v.u += Math.sign(du) * Math.min(Math.abs(du), maxStep, Math.abs(du) * (1 - Math.exp(-dt * 9)) + maxStep * 0.25)
        c.curve.getPoint(v.u, v.pos)
        if (v.dest == null && Math.abs(du) < 0.01) v.pos.y += Math.sin(t * 2 + v.pid) * 0.012
        const list = conduitPulses.get(v.ch!) ?? []
        list.push(v.u)
        conduitPulses.set(v.ch!, list)
        if (v.dest != null && v.u >= 0.999) {
          v.mode = 'exit'
          v.t = 0
          v.from.copy(v.pos)
        }
        break
      }
      case 'exit': {
        const c = v.dest != null ? creatures.get(v.dest) : null
        v.t = Math.min(1, v.t + dt / HOP)
        if (c) c.carryPoint(tmp, t)
        hop(v.from, tmp, v.t, 0.25, v.pos)
        if (v.t >= 1) {
          v.mode = 'carried'
          v.carrier = v.dest
          v.dest = null
          v.ch = null
        }
        break
      }
      case 'consume': {
        const c = v.carrier != null ? creatures.get(v.carrier) : null
        v.t += dt
        if (c) {
          c.local(0, 0.1 * c.size, -0.2 * c.size, tmp)
          v.pos.lerp(tmp, 1 - Math.exp(-dt * 8))
        }
        if (v.t > 0.45) {
          v.mode = 'dead'
          emitBurst(v.pos, PALETTE.payload, 22, 0.9)
        }
        break
      }
    }
  }

  return (
    <group>
      <primitive object={cores} />
      <primitive object={cages} />
    </group>
  )
}
