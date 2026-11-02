// Mirrors frontend/src/baseball/game/field.ts, the part scoring reads. The derby's field in meters: home plate at the
// origin, the pitcher toward -z. A spray angle of 0 is dead center and a positive one goes toward right field. Scores
// read this file, so it does arithmetic only: no trigonometry, whose last digits can differ between JavaScript engines.

/** Each foul line's angle from dead center, in radians. */
export const FOUL_ANGLE = Math.PI / 4
export const FENCE_DISTANCE = { line: 78, center: 92 }

/**
 * Where the bat squares up, in meters in front of the plate center: PERFECT is judged when the ball gets here rather
 * than at the plate.
 */
export const CONTACT_DEPTH = 0.4167

/** Which side of the plate the visitor bats from; a left-handed batter mirrors every spray. */
export type BattingSide = 'right' | 'left'

/** 78 m down the lines and 92 m to center, curving as a parabola in the spray angle so scoring needs no cosine. */
export function fenceDistance(spray: number) {
  const fraction = Math.min(1, Math.abs(spray) / FOUL_ANGLE)
  return FENCE_DISTANCE.line + (FENCE_DISTANCE.center - FENCE_DISTANCE.line) * (1 - fraction * fraction)
}
