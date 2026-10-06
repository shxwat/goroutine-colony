import { EventBus } from './bus'
import type { ColonyEvent } from './events'
import type { EventSource } from './sources/types'
import { World } from './world'

/**
 * Global, non-React home of the running colony. Per-frame consumers (the 3D
 * scene) read `session.world` directly; React UI only hears about changes
 * through the throttled store bridge.
 */
class Session {
  world = new World()
  readonly bus = new EventBus()
  source: EventSource | null = null
  private seq = 0

  /** Real seconds since the page started (never paused). */
  clock = 0
  /** Simulation seconds since the current run started. */
  simTime = 0
  /** dt applied to the scene this frame (0 while paused). */
  frameDt = 0
  paused = false
  speed = 1

  /**
   * Shared cinematic dials, eased by the FX director and read by everything
   * that animates. life: 1 = colony breathing, 0 = frozen solid.
   */
  readonly fx = {
    life: 1,
    glitch: 0,
    shake: 0,
    desaturate: 0,
    dim: 0,
  }

  load(source: EventSource) {
    this.source?.stop()
    this.resetWorld()
    this.source = source
    source.start(this.dispatch, this.world)
  }

  /** A fresh world under the same source (a live stream starting a new run). */
  resetWorld() {
    this.world = new World()
    this.seq = 0
    this.simTime = 0
    this.fx.life = 1
    this.fx.glitch = 0
    this.fx.shake = 0
    this.fx.desaturate = 0
    this.fx.dim = 0
    return this.world
  }

  dispatch = (e: ColonyEvent) => {
    e.seq = ++this.seq
    this.world.apply(e)
    this.bus.publish(e)
  }

  tick(realDt: number) {
    const dt = Math.min(realDt, 1 / 20)
    this.clock += dt
    this.frameDt = this.paused ? 0 : dt * this.speed
    if (this.frameDt > 0) {
      this.simTime += this.frameDt
      this.source?.update(this.frameDt)
    }
  }
}

export const session = new Session()
