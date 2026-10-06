import { Color, Euler, MathUtils, Quaternion, Vector3 } from 'three'
import type { GState } from '../simulation/events'
import { STATE_COLOR } from './palette'

/**
 * A goroutine's body: a small hexapod with procedural tripod gait and 2-bone
 * IK legs. Pure TypeScript — no React, no meshes. The colony renderer reads
 * the computed joint positions and writes them into instanced buffers.
 */

const UP = new Vector3(0, 1, 0)
const tmpA = new Vector3()
const tmpB = new Vector3()
const tmpC = new Vector3()

export interface CreatureInputs {
  state: GState
  target: Vector3
  /** Point to turn toward when standing still (a port, a gate, a cell). */
  face: Vector3 | null
  /** Pressing against something it cannot pass (blocked). */
  straining: boolean
  /** Speed (units/s) needed to make the current journey on time, if known. */
  pace?: number
  /** How its work ended; tints the body as it dissolves. */
  outcome?: Color | null
}

class Leg {
  readonly hip: Vector3
  readonly rest: Vector3
  readonly hipW = new Vector3()
  readonly kneeW = new Vector3()
  readonly foot = new Vector3()
  private from = new Vector3()
  private to = new Vector3()
  t = 1
  dur = 0.15

  constructor(
    hipX: number,
    hipZ: number,
    restX: number,
    restZ: number,
    readonly group: 0 | 1,
    readonly upper: number,
    readonly lower: number,
  ) {
    this.hip = new Vector3(hipX, 0, hipZ)
    this.rest = new Vector3(restX, 0, restZ)
  }

  get stepping() {
    return this.t < 1
  }

  /** 0..1 lift amount of the current step, for body bob. */
  get lift() {
    return this.t < 1 ? Math.sin(Math.PI * this.t) : 0
  }

  startStep(to: Vector3, dur: number) {
    this.from.copy(this.foot)
    this.to.copy(to)
    this.t = 0
    this.dur = dur
  }

  advance(dt: number, liftH: number) {
    if (this.t >= 1) return
    this.t = Math.min(1, this.t + dt / this.dur)
    const e = this.t * this.t * (3 - 2 * this.t)
    this.foot.lerpVectors(this.from, this.to, e)
    this.foot.y = Math.sin(Math.PI * this.t) * liftH
  }
}

export class Creature {
  readonly gid: number
  readonly size: number
  readonly seed: number
  readonly legs: Leg[] = []

  readonly pos = new Vector3()
  readonly vel = new Vector3()
  readonly quat = new Quaternion()
  yaw: number
  bodyY = 0.3
  pitch = 0
  roll = 0

  readonly color = new Color()
  /** Emissive intensity of the dorsal light. */
  glow = 1
  /** 0 → 1 while hatching. */
  appear = 0
  /** 0 → 1 while dissolving after DONE. */
  dissolve = 0
  state: GState = 'RUNNING'
  /** Seconds spent in current state. */
  stateAge = 0

  readonly headW = new Vector3()
  readonly antennae = [new Vector3(), new Vector3()]
  readonly antennaBase = [new Vector3(), new Vector3()]

  private twitch = 0
  /** 1 → 0 after waking from a park. */
  jolt = 0
  private flinch = 0
  private lastGroup = 0
  private restW = Array.from({ length: 6 }, () => new Vector3())
  private strain = 0
  private wander = 0
  private euler = new Euler(0, 0, 0, 'YXZ')
  private fwd = new Vector3()
  private right = new Vector3()

  constructor(gid: number, at: Vector3, yaw: number, size = 1) {
    this.gid = gid
    this.size = size
    this.seed = ((gid * 9301 + 49297) % 233280) / 233280
    this.pos.copy(at)
    this.yaw = yaw
    this.color.copy(STATE_COLOR.RUNNING)

    const s = size
    const stretch = 0.92 + this.seed * 0.18
    const reach = 0.95 + ((this.seed * 7) % 1) * 0.12
    // [hipZ, restX, restZ] per leg pair, front → back.
    const pairs: [number, number, number][] = [
      [0.12, 0.36, 0.34],
      [0.06, 0.42, 0.04],
      [0.0, 0.38, -0.27],
    ]
    pairs.forEach(([hz, rx, rz], i) => {
      for (const side of [-1, 1] as const) {
        const group = ((i + (side > 0 ? 1 : 0)) % 2) as 0 | 1
        this.legs.push(
          new Leg(side * 0.07 * s, hz * s * stretch, side * rx * s * reach, rz * s * stretch, group, 0.25 * s, 0.31 * s),
        )
      }
    })
    this.updateBasis()
    for (const leg of this.legs) this.toWorldGround(leg.rest, leg.foot)
  }

  /** Transform a body-local point to world space. */
  local(x: number, y: number, z: number, out: Vector3) {
    return out.set(x, y, z).applyQuaternion(this.quat).add(tmpC.set(this.pos.x, this.bodyY, this.pos.z))
  }

  /** Where a carried payload rides. */
  carryPoint(out: Vector3, t: number) {
    this.local(0, 0.22 * this.size, -0.12 * this.size, out)
    out.y += 0.05 + Math.sin(t * 3 + this.seed * 10) * 0.02
    return out
  }

  private toWorldGround(localRest: Vector3, out: Vector3) {
    out.copy(this.pos).addScaledVector(this.right, localRest.x).addScaledVector(this.fwd, localRest.z)
    out.y = 0
    return out
  }

  private updateBasis() {
    this.fwd.set(Math.sin(this.yaw), 0, Math.cos(this.yaw))
    this.right.set(Math.cos(this.yaw), 0, -Math.sin(this.yaw))
  }

  update(dt: number, t: number, life: number, input: CreatureInputs, neighbours: Iterable<Creature>) {
    if (input.state !== this.state) {
      const parked = (x: GState) => x === 'BLOCKED' || x === 'WAITING'
      // physical punctuation for transitions: a jolt on wake, a flinch on block
      if (parked(this.state) && input.state === 'RUNNING') this.jolt = 1
      if (input.state === 'BLOCKED') this.flinch = 1
      this.state = input.state
      this.stateAge = 0
    }
    this.jolt = Math.max(0, this.jolt - dt * 2.4)
    this.flinch = Math.max(0, this.flinch - dt * 3)
    this.stateAge += dt
    this.appear = Math.min(1, this.appear + dt * 1.6)
    if (this.state === 'DONE') this.dissolve = Math.min(1, this.dissolve + dt * 0.55)

    const s = this.size
    const st = this.state
    const alive = st !== 'DONE'

    // ── steering
    const maxSpeed = Math.max(
      st === 'RUNNING' ? 2.6 : st === 'WAITING' ? 1.9 : st === 'BLOCKED' ? 1.7 : st === 'SLEEPING' ? 0.7 : 0,
      st === 'DONE' ? 0 : Math.min(9, (input.pace ?? 0) * 1.15),
    )
    tmpA.subVectors(input.target, this.pos).setY(0)
    const d = tmpA.length()
    const desired = tmpB.set(0, 0, 0)
    if (alive && d > 0.04) {
      const speed = maxSpeed * MathUtils.smoothstep(d, 0.02, 1.3)
      desired.copy(tmpA).multiplyScalar(speed / d)
      // a little organic weave while travelling
      const weave = Math.sin(t * 4.2 + this.seed * 20) * 0.22 * MathUtils.clamp(speed / 2, 0, 1)
      desired.x += -tmpA.z / d * weave
      desired.z += tmpA.x / d * weave
    }
    if (alive) {
      for (const o of neighbours) {
        if (o === this || o.state === 'DONE') continue
        const dx = this.pos.x - o.pos.x
        const dz = this.pos.z - o.pos.z
        const min = 0.5 * (s + o.size)
        const dd = dx * dx + dz * dz
        if (dd < min * min && dd > 1e-6) {
          const k = ((min - Math.sqrt(dd)) / min) * 3.2
          desired.x += (dx / Math.sqrt(dd)) * k
          desired.z += (dz / Math.sqrt(dd)) * k
        }
      }
    }
    const accel = 1 - Math.exp(-dt * 5.5)
    this.vel.lerp(desired, accel)
    this.vel.multiplyScalar(MathUtils.lerp(0.0, 1, Math.min(1, life * 1.5)))
    this.pos.addScaledVector(this.vel, dt)
    const speed = this.vel.length()

    // ── heading
    let targetYaw = this.yaw
    if (speed > 0.25) targetYaw = Math.atan2(this.vel.x, this.vel.z)
    else if (input.face) targetYaw = Math.atan2(input.face.x - this.pos.x, input.face.z - this.pos.z)
    else if (alive) {
      this.wander += dt * (0.3 + this.seed * 0.3) * life
      targetYaw = this.yaw + Math.sin(this.wander * 1.7 + this.seed * 30) * 0.02
    }
    let dy = targetYaw - this.yaw
    dy = Math.atan2(Math.sin(dy), Math.cos(dy))
    this.yaw += dy * (1 - Math.exp(-dt * 7 * life))
    this.updateBasis()

    // ── strain: blocked bodies lean into what stops them
    const strainTarget = input.straining && life > 0.05 ? 1 : 0
    this.strain = MathUtils.damp(this.strain, strainTarget, 4, dt)

    // ── body height / attitude
    const baseH =
      (st === 'SLEEPING' ? 0.15 : st === 'BLOCKED' ? 0.25 : st === 'WAITING' ? 0.29 : 0.31) * s *
      (1 - this.dissolve * 0.75)
    let lift = 0
    for (const leg of this.legs) lift += leg.lift
    const breathe = Math.sin(t * (st === 'SLEEPING' ? 1.3 : 2.4) + this.seed * 9) * 0.01 * s * life
    const bob = (lift / 3) * 0.018 * s
    const shiver = st === 'BLOCKED' ? Math.sin(t * 38 + this.seed * 50) * 0.006 * s * life * this.strain : 0
    const pop = Math.sin(Math.min(1, (1 - this.jolt) * 1.4) * Math.PI) * this.jolt * 0.09 * s
    const dip = this.flinch * this.flinch * 0.06 * s
    this.bodyY = MathUtils.damp(this.bodyY, baseH + bob + breathe + shiver + pop - dip, 14, dt)

    const pitchTarget = this.flinch * 0.22 - this.jolt * 0.12 - this.strain * 0.16 + (st === 'SLEEPING' ? 0.08 : 0) - Math.min(speed, 2.5) * 0.025
    this.pitch = MathUtils.damp(this.pitch, pitchTarget, 6, dt)
    this.roll = MathUtils.damp(this.roll, -dy * 0.35 + Math.sin(t * 1.1 + this.seed * 7) * 0.02 * life, 6, dt)
    this.euler.set(this.pitch, this.yaw, this.roll)
    this.quat.setFromEuler(this.euler)

    // ── legs
    const lead = 0.16
    const stepDist = 0.17 * s
    const stepDur = MathUtils.clamp(0.2 - speed * 0.035, 0.1, 0.2)
    let stepping = -1
    for (const leg of this.legs) if (leg.stepping) stepping = leg.group

    this.twitch -= dt * life
    const forceTwitch = st === 'BLOCKED' && this.twitch <= 0 && life > 0.1 && stepping < 0
    if (forceTwitch) this.twitch = 0.18 + ((t * 13.7 + this.seed * 17) % 1) * 0.5
    const twitchLeg = forceTwitch ? Math.floor(((t * 91.3 + this.seed * 31) % 1) * 6) : -1

    const curl = this.dissolve
    const restScale = st === 'SLEEPING' ? 1.12 : 1
    const rests = this.restW
    const wants = [false, false]
    this.legs.forEach((leg, i) => {
      this.local(leg.hip.x, -0.01 * s, leg.hip.z, leg.hipW)
      const rx = leg.rest.x * restScale * (1 - curl * 0.65)
      const rz = leg.rest.z * (1 - curl * 0.5) + this.strain * 0.05 * s
      const r = rests[i].copy(this.pos).addScaledVector(this.right, rx).addScaledVector(this.fwd, rz)
      r.addScaledVector(this.vel, lead)
      r.y = 0
      if (!leg.stepping && leg.foot.distanceTo(r) > stepDist) wants[leg.group] = true
    })

    // tripod gait: groups take turns; a group may lift only while the other is planted
    let liftGroup = -1
    if (stepping < 0 && life > 0.02 && curl === 0) {
      const other = 1 - this.lastGroup
      liftGroup = wants[other] ? other : wants[this.lastGroup] ? this.lastGroup : -1
      if (liftGroup >= 0) this.lastGroup = liftGroup
    }

    this.legs.forEach((leg, i) => {
      const restW = rests[i]
      if (curl > 0) {
        // dying: legs fold up under the body
        leg.foot.lerp(restW, 1 - Math.exp(-dt * 3))
        leg.foot.y = MathUtils.lerp(leg.foot.y, this.bodyY * 0.7 * curl, 1 - Math.exp(-dt * 3))
      } else if (leg.stepping) {
        leg.advance(dt * Math.max(life, 0.0001), 0.09 * s)
      } else if (leg.group === liftGroup || leg.foot.distanceTo(restW) > stepDist * 3) {
        leg.startStep(restW, stepDur)
      } else if (i === twitchLeg) {
        restW.addScaledVector(this.fwd, 0.05 * s + (((t * 7 + i) % 1) - 0.5) * 0.05)
        restW.addScaledVector(this.right, (((t * 5.3 + i) % 1) - 0.5) * 0.06)
        leg.startStep(restW, 0.09)
      }
      solveKnee(leg.hipW, leg.foot, leg.upper, leg.lower, this.right, leg.hip.x > 0 ? 1 : -1, leg.kneeW)
    })

    // ── head + antennae
    this.local(0, 0.03 * s, 0.27 * s, this.headW)
    for (let k = 0; k < 2; k++) {
      const side = k === 0 ? -1 : 1
      this.local(side * 0.03 * s, 0.07 * s, 0.31 * s, this.antennaBase[k])
      const sway = Math.sin(t * (st === 'WAITING' ? 5 : 2.6) + this.seed * 13 + k * 1.7) * 0.045 * life
      const droop = st === 'SLEEPING' ? -0.12 : st === 'DONE' ? -0.2 : 0
      this.local(side * (0.09 + sway) * s, (0.17 + droop + sway * 0.5) * s, (0.46 - this.strain * 0.04) * s, this.antennae[k])
    }

    // ── colour + light
    this.color.lerp(st === 'DONE' && input.outcome ? input.outcome : STATE_COLOR[st], 1 - Math.exp(-dt * 5))
    const pulse =
      st === 'BLOCKED'
        ? 0.75 + 0.5 * Math.abs(Math.sin(t * 5 + this.seed * 3)) * life
        : st === 'WAITING'
          ? 0.85 + 0.25 * Math.sin(t * 2.2 + this.seed * 5) * life
          : st === 'SLEEPING'
            ? 0.35 + 0.2 * Math.sin(t * 1.1 + this.seed * 5)
            : st === 'DONE'
              ? (input.outcome ? 2.2 : 0.25) * (1 - this.dissolve)
              : 1.05 + 0.15 * Math.sin(t * 3 + this.seed * 5)
    this.glow = MathUtils.damp(this.glow, pulse * (0.35 + 0.65 * life) + this.jolt * 1.4 + this.flinch * 0.8, 8, dt)
  }

  /** Ground-plane distance to a point. */
  distanceTo(p: Vector3) {
    return Math.hypot(p.x - this.pos.x, p.z - this.pos.z)
  }
}

/** Two-bone IK; knees bend upward and outward like an insect. */
function solveKnee(hip: Vector3, foot: Vector3, a: number, b: number, right: Vector3, side: number, out: Vector3) {
  const dir = tmpB.subVectors(foot, hip)
  let d = dir.length()
  d = MathUtils.clamp(d, Math.abs(a - b) + 1e-3, a + b - 1e-3)
  dir.normalize()
  const along = (a * a - b * b + d * d) / (2 * d)
  const h = Math.sqrt(Math.max(0, a * a - along * along))
  const bend = tmpC.copy(UP).multiplyScalar(1).addScaledVector(right, side * 0.45)
  bend.addScaledVector(dir, -bend.dot(dir)).normalize()
  out.copy(hip).addScaledVector(dir, along).addScaledVector(bend, h)
}
