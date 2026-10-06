import { Vector3 } from 'three'
import {
  anchorPos,
  CHAMBER_RADIUS,
  channelFrame,
  gateDir,
  PORT_STANDOFF,
  type V3,
} from '../simulation/layout'
import type { GoroutineModel, World } from '../simulation/world'

/**
 * Turns semantic state ("parked 3rd in line on jobs' send port") into a
 * physical destination. Queues are derived from park order, so the shape of a
 * traffic jam is simply a picture of the runtime's wait queue.
 */

export interface Intent {
  target: Vector3
  face: Vector3 | null
  straining: boolean
}

const QUEUE_GAP = 0.78
const v3: V3 = [0, 0, 0]

export function resolveIntent(world: World, g: GoroutineModel, out: Intent): Intent {
  out.face = null
  out.straining = false
  const parked = g.state === 'BLOCKED' || g.state === 'WAITING'

  if (parked && g.blockedOn && g.reason) {
    const q = world.queue(g.blockedOn, g.reason)
    const i = Math.max(0, q.findIndex((x) => x.gid === g.gid))
    // a short queue is a line; a long one becomes a crowd pressing at the door
    const crowd = q.length > 5
    const row = crowd ? Math.floor(i / 4) : i
    const col = crowd ? (i % 4) - 1.5 + (row % 2) * 0.35 : 0
    const lateral = crowd ? col * 0.6 : i === 0 ? 0 : i % 2 ? 0.26 : -0.26
    const depth = crowd ? row * 0.7 : i * QUEUE_GAP

    if (g.reason === 'chan send' || g.reason === 'chan receive') {
      const ch = world.channels.get(g.blockedOn)
      if (ch) {
        const f = channelFrame(ch.layout)
        const send = g.reason === 'chan send'
        const port = send ? f.a : f.b
        const sgn = send ? -1 : 1
        const d = PORT_STANDOFF + depth
        out.target.set(
          port[0] + f.dir[0] * d * sgn - f.dir[1] * lateral,
          0,
          port[2] + f.dir[1] * d * sgn + f.dir[0] * lateral,
        )
        out.face = (out.face ?? new Vector3()).set(port[0], 0, port[2])
        out.straining = g.state === 'BLOCKED'
        return out
      }
    }

    if (g.reason === 'sync.Mutex.Lock') {
      const mu = world.mutexes.get(g.blockedOn)
      if (mu) {
        const [gx, gz] = gateDir(mu.layout)
        const [px, pz] = mu.layout.pos
        const d = CHAMBER_RADIUS + 0.62 + depth
        out.target.set(px + gx * d - gz * lateral, 0, pz + gz * d + gx * lateral)
        out.face = (out.face ?? new Vector3()).set(px, 0, pz)
        out.straining = true
        return out
      }
    }
  }

  anchorPos(world, g.anchor, v3)
  out.target.set(v3[0], 0, v3[2])

  // Settled somewhere: drift a little, like something alive.
  const arrived = world.t - g.moveAt > g.moveDuration
  if (arrived && (g.state === 'RUNNING' || g.state === 'WAITING') && !g.anchor.endsWith('.send') && !g.anchor.endsWith('.recv')) {
    const k = g.gid * 1.618
    const r = g.anchor.endsWith('.inside') ? 0.25 : 0.32
    out.target.x += Math.sin(world.t * 0.45 + k) * r
    out.target.z += Math.cos(world.t * 0.37 + k * 1.3) * r * 0.8
  }

  out.face = faceFor(world, g.anchor, out.face)
  return out
}

function faceFor(world: World, anchor: string, out: Vector3 | null): Vector3 | null {
  const dot = anchor.lastIndexOf('.')
  if (dot < 0) return anchor === 'main' ? (out ?? new Vector3()).set(0, 0, 4) : null
  const name = anchor.slice(0, dot)
  const port = anchor.slice(dot + 1)
  const ch = world.channels.get(name)
  if (ch) {
    const f = channelFrame(ch.layout)
    const p = port === 'send' ? f.a : f.b
    return (out ?? new Vector3()).set(p[0], 0, p[2])
  }
  const mu = world.mutexes.get(name)
  if (mu && port === 'gate') return (out ?? new Vector3()).set(mu.layout.pos[0], 0, mu.layout.pos[1])
  const mem = world.memory.get(name)
  if (mem) return (out ?? new Vector3()).set(mem.layout.pos[0], 0, mem.layout.pos[1])
  return null
}
