import { Color, Vector3 } from 'three'
import type { Creature } from '../entities/creature'
import { session } from '../simulation/session'

/**
 * Frame-rate shared state between scene systems (never React state).
 * Bodies are registered by the colony; FX, tethers, payloads and the camera
 * look them up by gid.
 */
export const creatures = new Map<number, Creature>()

export interface Ripple {
  x: number
  z: number
  t0: number
  color: Color
  strength: number
}

const MAX_RIPPLES = 8
export const ripples: Ripple[] = []

/** A ring wave across the floor — the world physically reacting to an event. */
export function ripple(x: number, z: number, color: Color, strength = 1) {
  ripples.push({ x, z, t0: session.clock, color, strength })
  if (ripples.length > MAX_RIPPLES) ripples.shift()
}

export function creaturePos(gid: number, out: Vector3): Vector3 | null {
  const c = creatures.get(gid)
  return c ? out.copy(c.pos) : null
}

if (import.meta.env.DEV) {
  ;(window as unknown as { __colony: unknown }).__colony = { creatures, session }
}
