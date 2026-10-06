import { buffered } from './buffered'
import { deadlock } from './deadlock'
import { mutex } from './mutex'
import { race } from './race'
import type { CameraShot, Scenario } from './types'
import { unbuffered } from './unbuffered'

export const SCENARIOS: Scenario[] = [unbuffered, buffered, mutex, race, deadlock]

export const DEFAULT_SCENARIO = 'buffer'

export const scenarioById = (id: string) => SCENARIOS.find((s) => s.id === id) ?? SCENARIOS[1]

/** Framing for live streams: the lock in front, the auto-laid memory grid to its right. */
export const LIVE_SHOT: CameraShot = { target: [-0.6, 0.6, 1.4], distance: 11.4, elevation: 0.52, azimuth: 0 }
