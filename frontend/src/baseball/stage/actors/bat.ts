import { CylinderGeometry, LatheGeometry, Mesh, Vector2, Vector3 } from 'three'
import { clamp } from '../../../motionMath'
import { type BallplayerRig, rigMaterial } from './ballplayerRig'

// The batter's bat in its own frame: the knob at the origin, the barrel up +y, in the rig's town units (an 84 cm bat
// for the 1.75 m player). The grip tape is thickened from life size so the handle still reads through a mitten.

export const BAT = {
  length: 1.006,
  /** From the knob to the sweet spot, where the bat meets the ball. */
  sweetSpot: 0.84,
  /** From the knob to the midpoint of the two hands. */
  gripMiddle: 0.2125,
  handleRadius: 0.027,
  /** The grip tape runs from just above the knob to here. */
  tapeEnd: 0.44,
}

/** The bat's radius along its length from the knob: the knob's flare, the grip tape, then the barrel. */
export const BAT_RADII: [height: number, radius: number][] = [
  [0, 0.043],
  [0.022, 0.045],
  [0.04, 0.027],
  [0.44, 0.027],
  [0.441, 0.0205],
  [0.5, 0.022],
  [0.68, 0.032],
  [0.82, 0.039],
  [0.95, 0.04],
  [1.006, 0.036],
]

/** The wood's outline for the lathe (radius, height): thinner under the tape, which wraps it as its own cylinder. */
const WOOD_PROFILE: [radius: number, height: number][] = [
  [0, 0],
  [0.043, 0.004],
  [0.045, 0.022],
  [0.026, 0.04],
  [0.016, 0.12],
  [0.017, 0.32],
  [0.022, 0.5],
  [0.032, 0.68],
  [0.039, 0.82],
  [0.04, 0.95],
  [0.036, 0.995],
  [0, BAT.length],
]
const TAPE_START = 0.04

/** Shared by every bat: the stage has one batter at a time, and the geometry never changes. */
export const batGeometries = {
  wood: new LatheGeometry(
    WOOD_PROFILE.map(([radius, height]) => new Vector2(radius, height)),
    18,
  ),
  tape: new CylinderGeometry(BAT.handleRadius, BAT.handleRadius, BAT.tapeEnd - TAPE_START, 20),
}

/** A bat in the old game bat's colors with our team's navy grip tape, in materials the rig owns. */
export function createBat(owner: Pick<BallplayerRig, 'materials'>) {
  const bat = new Mesh(batGeometries.wood, rigMaterial(owner, '#c99a63', 0.55))
  const tape = new Mesh(batGeometries.tape, rigMaterial(owner, '#374b65', 0.9))
  tape.position.y = (TAPE_START + BAT.tapeEnd) / 2
  bat.castShadow = true
  tape.castShadow = true
  bat.add(tape)
  return bat
}

export function batRadiusAt(height: number) {
  const along = clamp(height, 0, BAT.length)
  const upper = Math.max(
    1,
    BAT_RADII.findIndex(([at]) => at >= along),
  )
  const [fromHeight, fromRadius] = BAT_RADII[upper - 1]
  const [toHeight, toRadius] = BAT_RADII[upper]
  return fromRadius + ((toRadius - fromRadius) * (along - fromHeight)) / (toHeight - fromHeight)
}

const fromKnob = new Vector3()

/** How deep a sphere reaches into a bat whose knob is at `knob` pointing along `axis` (units; 0 when clear). */
export function batPenetration(knob: Vector3, axis: Vector3, center: Vector3, radius: number) {
  fromKnob.copy(center).sub(knob)
  const height = fromKnob.dot(axis)
  const radial = Math.sqrt(Math.max(0, fromKnob.lengthSq() - height * height))
  const offsets = Array.from({ length: 9 }, (_, step) => ((step - 4) / 4) * radius)
  const depths = offsets
    .filter((offset) => height + offset >= 0 && height + offset <= BAT.length)
    .map((offset) => batRadiusAt(height + offset) + Math.sqrt(radius * radius - offset * offset) - radial)
  return Math.max(0, ...depths)
}
