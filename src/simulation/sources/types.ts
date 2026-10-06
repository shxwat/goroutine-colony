import type { ColonyEvent } from '../events'
import type { World } from '../world'

export type DispatchInput = ColonyEvent
export type Dispatch = (e: DispatchInput) => void

/**
 * Anything that can feed the colony: the in-browser simulated runtime, or a
 * live stream of events from an instrumented Go process.
 */
export interface EventSource {
  readonly kind: 'simulated' | 'live'
  start(dispatch: Dispatch, world: World): void
  /** Advance by dt seconds of simulation time. Live sources may ignore it. */
  update(dt: number): void
  stop(): void
}
