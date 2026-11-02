import { Group, SphereGeometry, Vector3 } from 'three'
import { addPart, type BallplayerRig, basis } from './ballplayerRig'

// The fielders' hands off the bat: a leather glove or catcher's mitt (a squashed ball, as round as the mittens), and a
// way to set any hand, mitten or glove, along a forearm as last posed.

/** Half-sizes (rig units) of a glove: across the hand, along the fingers, and palm to back. */
export type GloveSize = { wide: number; long: number; thick: number }

export const LEATHER = '#7a4a2a'
/** The pitcher's and the fielders' glove: its half-sizes (rig units) and how far past the wrist its center sits. */
export const FIELDER_GLOVE = { wide: 0.15, long: 0.19, thick: 0.08, ahead: 0.12 }
const gloveGeometry = new SphereGeometry(1, 18, 12)

/** A glove of `size` in leather, added to the rig's root; its own frame is a mitten's (mittenHands.ts). */
export function createGlove(rig: BallplayerRig, size: GloveSize) {
  const glove = new Group()
  const leather = addPart(rig, glove, gloveGeometry, LEATHER, 0.8)
  leather.scale.set(size.thick, size.wide, size.long)
  rig.root.add(glove)
  return glove
}

const forearm = new Vector3()
const across = new Vector3()

/**
 * Sets `hand` on arm `index` as last posed: `ahead` (rig units) past the wrist along the forearm, its fingers (+z)
 * along it and its width (+y) toward `up`.
 */
export function alignHand(hand: Group, rig: BallplayerRig, index: number, up: Vector3, ahead: number) {
  forearm.copy(rig.wrists[index]).sub(rig.elbows[index]).normalize()
  across.copy(up).addScaledVector(forearm, -up.dot(forearm))
  if (across.lengthSq() < 1e-8) across.set(forearm.y, -forearm.z, forearm.x)
  basis(hand.quaternion, across, forearm)
  hand.position.copy(rig.wrists[index]).addScaledVector(forearm, ahead)
}
