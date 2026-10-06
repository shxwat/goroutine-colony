import { create } from 'zustand'
import type { CellValue, GState, Outcome } from '../simulation/events'
import type { StreamInfo } from '../simulation/world'
import type { LinkStatus } from '../simulation/sources/websocketSource'

export interface Stats {
  total: number
  RUNNING: number
  WAITING: number
  BLOCKED: number
  SLEEPING: number
  DONE: number
}

export interface LogLine {
  seq: number
  t: number
  gid: number | null
  line: number | null
  text: string
  tone: 'run' | 'block' | 'wait' | 'sync' | 'fatal' | 'out' | 'dim'
}

export interface LineMarker {
  gid: number
  state: GState
}

export type HoverTarget =
  | { kind: 'goroutine'; id: number }
  | { kind: 'channel'; id: string }
  | { kind: 'mutex'; id: string }
  | { kind: 'memory'; id: string }

export type Verdict =
  | { kind: 'race'; mem: string; value: CellValue; expected: CellValue; gids: number[]; frames: string[]; title?: string; detail?: string }
  | { kind: 'deadlock'; lines: string[] }

interface ColonyState {
  scenarioId: string
  /** Bumped on every (re)start; reloads the event source. */
  runKey: number
  /** Bumped whenever the world is replaced; scene parts keyed on it remount cleanly. */
  sceneKey: number
  /** Set when a live stream drives the colony (?ws=…). */
  live: { url: string; status: LinkStatus } | null
  /** What the live producer says about itself, and how its requests ended. */
  stream: StreamInfo | null
  tally: { requests: number } & Record<Outcome, number>
  paused: boolean
  muted: boolean
  stats: Stats
  log: LogLine[]
  /** Which goroutines sit on which source line. */
  markers: Record<number, LineMarker[]>
  /** Most recently executed line, for a flash. */
  lastLine: { line: number; seq: number } | null
  resources: { channels: string[]; mutexes: string[]; memory: string[] }
  hover: HoverTarget | null
  selected: number | null
  verdict: Verdict | null

  setScenario: (id: string) => void
  replay: () => void
  togglePause: () => void
  setPaused: (p: boolean) => void
  toggleMute: () => void
  setHover: (h: HoverTarget | null) => void
  select: (gid: number | null) => void
  setVerdict: (v: Verdict | null) => void
  liveReset: () => void
  setLinkStatus: (status: LinkStatus) => void
}

/** ?ws=ws://host:port/path connects to a live event stream instead of a scenario. */
function liveUrl(): string | null {
  return new URLSearchParams(location.search).get('ws')
}

/** ?scenario=deadlock deep-links straight into a story. */
function initialScenario() {
  const ids = ['channel', 'buffer', 'mutex', 'race', 'deadlock']
  const q = new URLSearchParams(location.search).get('scenario')
  return q && ids.includes(q) ? q : 'buffer'
}

const emptyTally = { requests: 0, success: 0, rejected: 0, error: 0 }

const emptyStats: Stats = { total: 0, RUNNING: 0, WAITING: 0, BLOCKED: 0, SLEEPING: 0, DONE: 0 }

export const useColony = create<ColonyState>((set) => ({
  scenarioId: initialScenario(),
  runKey: 0,
  sceneKey: 0,
  live: liveUrl() ? { url: liveUrl()!, status: 'connecting' } : null,
  stream: null,
  tally: emptyTally,
  paused: false,
  muted: true,
  stats: emptyStats,
  log: [],
  markers: {},
  lastLine: null,
  resources: { channels: [], mutexes: [], memory: [] },
  hover: null,
  selected: null,
  verdict: null,

  setScenario: (id) => set((s) => ({ scenarioId: id, runKey: s.runKey + 1, sceneKey: s.sceneKey + 1, ...resetRun })),
  replay: () => set((s) => ({ runKey: s.runKey + 1, sceneKey: s.sceneKey + 1, ...resetRun })),
  liveReset: () => set((s) => ({ sceneKey: s.sceneKey + 1, ...resetRun })),
  setLinkStatus: (status) => set((s) => (s.live ? { live: { ...s.live, status } } : s)),
  togglePause: () => set((s) => ({ paused: !s.paused })),
  setPaused: (paused) => set({ paused }),
  toggleMute: () => set((s) => ({ muted: !s.muted })),
  setHover: (hover) =>
    set((s) => (sameHover(s.hover, hover) ? s : { hover })),
  select: (selected) => set({ selected }),
  setVerdict: (verdict) => set({ verdict }),
}))

const resetRun = {
  tally: emptyTally,
  paused: false,
  stats: emptyStats,
  log: [] as LogLine[],
  markers: {},
  lastLine: null,
  resources: { channels: [], mutexes: [], memory: [] },
  hover: null,
  selected: null,
  verdict: null,
}

function sameHover(a: HoverTarget | null, b: HoverTarget | null) {
  if (a === b) return true
  if (!a || !b) return false
  return a.kind === b.kind && a.id === b.id
}

if (import.meta.env.DEV) {
  ;(window as unknown as { __store: unknown }).__store = useColony
}
