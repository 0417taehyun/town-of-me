// The derby's field in meters: home plate at the origin, the pitcher toward -z, first base on +x, y up. A spray angle
// of 0 is dead center and a positive one goes toward right field (+x). Scores read this file, so it does arithmetic
// only: no trigonometry, whose last digits can differ between JavaScript engines.

export const MOUND_DISTANCE = 18.44
export const BASE_DISTANCE = 27.43
/** Each foul line's angle from dead center, in radians. */
export const FOUL_ANGLE = Math.PI / 4
/** The hedge a home run's flight passes over. */
export const FENCE_HEIGHT = 3
export const FENCE_DISTANCE = { line: 78, center: 92 }

const baseOffset = BASE_DISTANCE / Math.SQRT2
export const BASES = {
  home: { x: 0, z: 0 },
  first: { x: baseOffset, z: -baseOffset },
  second: { x: 0, z: -2 * baseOffset },
  third: { x: -baseOffset, z: -baseOffset },
}

/** Where the seven fielders stand while a pitch is on its way; the game places the pitcher and catcher itself. */
export const FIELDER_SPOTS = {
  first: { x: 21.5, z: -23.5 },
  second: { x: 9, z: -33.5 },
  shortstop: { x: -9, z: -33.5 },
  third: { x: -21.5, z: -23.5 },
  left: { x: -30, z: -58 },
  center: { x: 0, z: -70 },
  right: { x: 30, z: -58 },
}

/** Heights above the plate (m) and half its width: waist height for the town character, whose hips sit about 0.6 m up. */
export const STRIKE_ZONE = { bottom: 0.35, top: 0.85, center: 0.6, halfWidth: 0.25 }

/**
 * Where the bat squares up, in meters in front of the plate center (field z = -CONTACT_DEPTH): the pose lab's contact
 * meets the ball half a rig unit (0.5 × 0.8333 m) in front of the batter's feet, which stand level with the plate
 * center. PERFECT is judged when the ball gets here rather than at the plate, so an on-time swing meets it with the bat
 * square. The swing keyframes must square the bat at this depth; PR 7 adds the test that ties them to it.
 */
export const CONTACT_DEPTH = 0.4167

/** The depths (m in front of the plate center; minus is behind it) between which the bat can meet the ball at all. */
export const BATTER_REACH = { front: 0.82, back: -0.21 }

/** Which side of the plate the visitor bats from; a left-handed batter mirrors every spray. */
export type BattingSide = 'right' | 'left'

/**
 * A cozy park: 78 m down the lines and 92 m to center, curving as a parabola in the spray angle so scoring needs no
 * cosine (it stays within 0.8 m of the drafts' 78 + 14·cos 2θ).
 */
export function fenceDistance(spray: number) {
  const fraction = Math.min(1, Math.abs(spray) / FOUL_ANGLE)
  return FENCE_DISTANCE.line + (FENCE_DISTANCE.center - FENCE_DISTANCE.line) * (1 - fraction * fraction)
}
