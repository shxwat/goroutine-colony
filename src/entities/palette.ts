import { Color } from 'three'
import type { GState } from '../simulation/events'

/** One restrained palette. Go cyan is the colour of life; everything else is an exception. */
export const PALETTE = {
  void: new Color('#030508'),
  floor: new Color('#06090d'),
  structure: new Color('#1b2630'),
  go: new Color('#00add8'),
  goSoft: new Color('#5fd4f0'),
  amber: new Color('#f0a640'),
  ember: new Color('#ff3d2e'),
  violet: new Color('#6a70e8'),
  payload: new Color('#ffcf7a'),
  bone: new Color('#c9d3dc'),
  dead: new Color('#2a323a'),
}

export const STATE_COLOR: Record<GState, Color> = {
  RUNNING: PALETTE.go,
  WAITING: PALETTE.amber,
  BLOCKED: PALETTE.ember,
  SLEEPING: PALETTE.violet,
  DONE: PALETTE.dead,
}

export const STATE_HEX: Record<GState, string> = {
  RUNNING: '#00add8',
  WAITING: '#f0a640',
  BLOCKED: '#ff3d2e',
  SLEEPING: '#7c82f0',
  DONE: '#4a545e',
}
