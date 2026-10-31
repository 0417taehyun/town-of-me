import { Vector3 } from 'three'
import { clamp } from '../../../motionMath'

const chainAxis = new Vector3()
const bendDirection = new Vector3()

/**
 * The share of a stretching chain's length over which it eases into its full reach. Every stretching arm (the
 * batter's, the catcher's, and the pitcher's) reaching that far is drawn a little long, 3% by its full reach and about
 * 2% in the batter's stance, too little to see.
 */
export const SOFT_REACH = 0.08

/**
 * How far a stretching chain `length` long bends to reach `distance`: the distance itself, then, over the last
 * SOFT_REACH of the length, less and less of it, never quite straight. A chain bent exactly to the distance snaps
 * straight as the distance nears its length, its middle joint whipping in a moment ("soft IK").
 */
export function softReach(distance: number, length: number) {
  const soft = SOFT_REACH * length
  const start = length - soft
  if (distance <= start) return distance
  return start + soft * (1 - Math.exp(-(distance - start) / soft))
}

/**
 * Analytic two-bone IK: a chain from `root` of bones `upper` and `lower` long reaching for `target`, its middle joint
 * bending toward `pole`. Writes the middle joint into `middle` and the reached end into `end`; a target out of reach is
 * pointed at with the chain straight. With `stretch`, the chain bends to its soft reach and both bones lengthen evenly
 * to reach the target from there, so it eases into a reach past its length instead of snapping straight, and the factor
 * they stretched by is returned (1 = none).
 */
export function solveTwoBone(
  root: Vector3,
  target: Vector3,
  upper: number,
  lower: number,
  pole: Vector3,
  middle: Vector3,
  end: Vector3,
  stretch = false,
) {
  chainAxis.copy(target).sub(root)
  const distance = Math.max(1e-6, chainAxis.length())
  chainAxis.divideScalar(distance)
  const factor = stretch ? distance / softReach(distance, upper + lower) : 1
  const upperLength = upper * factor
  const lowerLength = lower * factor
  const reach = clamp(distance, Math.abs(upperLength - lowerLength) + 1e-4, (upperLength + lowerLength) * 0.9999)
  const along = (upperLength * upperLength - lowerLength * lowerLength + reach * reach) / (2 * reach)
  const height = Math.sqrt(Math.max(0, upperLength * upperLength - along * along))
  bendDirection.copy(pole).addScaledVector(chainAxis, -pole.dot(chainAxis))
  // A pole along the chain gives no side to bend toward: bend down instead.
  if (bendDirection.lengthSq() < 1e-8) bendDirection.set(0, -1, 0).addScaledVector(chainAxis, chainAxis.y)
  bendDirection.normalize()
  middle.copy(root).addScaledVector(chainAxis, along).addScaledVector(bendDirection, height)
  end.copy(root).addScaledVector(chainAxis, reach)
  return factor
}
