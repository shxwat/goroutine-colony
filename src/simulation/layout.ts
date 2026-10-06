import type { ChannelLayout, MutexLayout, XZ } from './events'
import type { World } from './world'

/**
 * Spatial vocabulary shared by the simulated runtime (to estimate walking
 * time) and the renderer (to place things). Anchors are named spots:
 *
 *   core              where `go f()` emerges
 *   main              home of the main goroutine
 *   p:x:z             an arbitrary ground point
 *   <ch>.send         in front of a channel's send port
 *   <ch>.recv         in front of a channel's receive port
 *   <mu>.gate         outside a mutex chamber's gate
 *   <mu>.inside       the protected area
 *   <mem>.l|.r|.f     left / right / front of a memory cell
 */

export type V3 = [number, number, number]

export const CORE_POS: V3 = [0, 0, -6]
export const SPAWN_POS: V3 = [0, 0, -4.5]
export const MAIN_HOME: V3 = [-1.9, 0, -3.6]

export const WALK_SPEED = 2.4
export const TUBE_Y = 0.78
export const TUBE_ARCH = 0.35
export const PORT_STANDOFF = 0.62
export const CHAMBER_RADIUS = 1.3

export const at = (x: number, z: number) => `p:${x}:${z}`

export interface ChannelFrame {
  a: V3
  b: V3
  mid: V3
  dir: XZ
  length: number
}

export function channelFrame(l: ChannelLayout): ChannelFrame {
  const [ax, az] = l.from
  const [bx, bz] = l.to
  const dx = bx - ax
  const dz = bz - az
  const length = Math.hypot(dx, dz) || 1
  return {
    a: [ax, TUBE_Y, az],
    b: [bx, TUBE_Y, bz],
    mid: [(ax + bx) / 2, TUBE_Y + TUBE_ARCH * 2, (az + bz) / 2],
    dir: [dx / length, dz / length],
    length,
  }
}

/** Point along a channel's conduit; u ∈ [0,1] from send port to receive port. */
export function channelPoint(f: ChannelFrame, u: number, out: V3 = [0, 0, 0]): V3 {
  const a = (1 - u) * (1 - u)
  const b = 2 * u * (1 - u)
  const c = u * u
  out[0] = a * f.a[0] + b * f.mid[0] + c * f.b[0]
  out[1] = a * f.a[1] + b * f.mid[1] + c * f.b[1]
  out[2] = a * f.a[2] + b * f.mid[2] + c * f.b[2]
  return out
}

/** Buffer slot position along the conduit; slot 0 is the head (nearest the receive port). */
export function slotU(index: number, cap: number): number {
  if (cap <= 1) return 0.5
  const lo = 0.24
  const hi = 0.76
  return hi - (index * (hi - lo)) / (cap - 1)
}

export function gateDir(l: MutexLayout): XZ {
  return [Math.sin(l.gate), Math.cos(l.gate)]
}

export function anchorPos(world: World, id: string, out: V3 = [0, 0, 0]): V3 {
  if (id === 'core') return set(out, SPAWN_POS)
  if (id === 'main') return set(out, MAIN_HOME)
  if (id.startsWith('p:')) {
    const [, x, z] = id.split(':')
    out[0] = +x
    out[1] = 0
    out[2] = +z
    return out
  }
  const dot = id.lastIndexOf('.')
  const name = id.slice(0, dot)
  const port = id.slice(dot + 1)

  const ch = world.channels.get(name)
  if (ch) {
    const f = channelFrame(ch.layout)
    const s = port === 'send' ? -PORT_STANDOFF : PORT_STANDOFF
    const base = port === 'send' ? f.a : f.b
    out[0] = base[0] + f.dir[0] * s
    out[1] = 0
    out[2] = base[2] + f.dir[1] * s
    return out
  }
  const mu = world.mutexes.get(name)
  if (mu) {
    const [px, pz] = mu.layout.pos
    if (port === 'inside') return set(out, [px, 0, pz])
    const [gx, gz] = gateDir(mu.layout)
    const r = CHAMBER_RADIUS + 0.75
    out[0] = px + gx * r
    out[1] = 0
    out[2] = pz + gz * r
    return out
  }
  const mem = world.memory.get(name)
  if (mem) {
    const [px, pz] = mem.layout.pos
    const off: Record<string, XZ> = { l: [-0.95, 0.25], r: [0.95, 0.25], f: [0, 0.95] }
    const [ox, oz] = off[port] ?? off.f
    out[0] = px + ox
    out[1] = 0
    out[2] = pz + oz
    return out
  }
  return set(out, SPAWN_POS)
}

function set(out: V3, v: V3): V3 {
  out[0] = v[0]
  out[1] = v[1]
  out[2] = v[2]
  return out
}

export function dist2D(a: V3, b: V3) {
  return Math.hypot(a[0] - b[0], a[2] - b[2])
}

// ───────────────────────────────────────────────────── auto layout (live sources)

/**
 * Placement for resources a live producer did not position. Locks stand in
 * front of the runtime with their gate facing left; grouped memory (e.g. seats)
 * forms a grid to the right of them, growing toward the camera.
 */
export function autoMutexLayout(index: number): MutexLayout {
  return { pos: [-1.1 - index * 4.2, 0.2], gate: -Math.PI / 2 }
}

export function autoMemoryLayout(index: number, grouped: boolean) {
  const cols = 3
  const col = index % cols
  const row = Math.floor(index / cols)
  return grouped ? { pos: [2.0 + col * 1.3, -1.4 + row * 1.5] as XZ } : { pos: [2.1 + col * 1.6, -1.2 + row * 1.6] as XZ }
}
