import type { V3 } from '../simulation/layout'
import type { Program } from '../simulation/program'

export interface CameraShot {
  target: V3
  distance: number
  /** Radians above the ground plane. */
  elevation: number
  /** Radians around Y; 0 looks from +z. */
  azimuth: number
}

export interface Scenario {
  id: string
  /** Selector label. */
  label: string
  /** One short line that frames what to watch. */
  caption: string
  /** Go source shown in the code panel; 1-indexed lines are referenced by ops. */
  code: string[]
  shot: CameraShot
  /** Seconds to hold the final frame before auto-replay. */
  hold: number
  main: () => Program
}
