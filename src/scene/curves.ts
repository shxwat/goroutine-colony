import { Curve, Vector3 } from 'three'
import { channelPoint, type ChannelFrame, type V3 } from '../simulation/layout'

const tmp: V3 = [0, 0, 0]

/** The conduit's centreline as a three.js curve (shares math with the simulation). */
export class ConduitCurve extends Curve<Vector3> {
  constructor(private readonly frame: ChannelFrame) {
    super()
  }

  override getPoint(u: number, out = new Vector3()) {
    channelPoint(this.frame, u, tmp)
    return out.set(tmp[0], tmp[1], tmp[2])
  }
}

/** Live payload positions inside each conduit (u along the curve), written by Payloads. */
export const conduitPulses = new Map<string, number[]>()
