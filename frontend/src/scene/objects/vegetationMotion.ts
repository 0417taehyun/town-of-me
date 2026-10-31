import { clamp, damp } from '../../motionMath'

export type VegetationBend = { x: number; z: number }
export type InfluencePosition = { x: number; z: number }
export type PositionedInfluence = { position: InfluencePosition }

const REACTION_RADIUS = 1.75

/** The breeze every plant shares; the foliage shader reads the same numbers so weeds, flowers, and crowns move together. */
export const ambientWind = { phaseX: 0.7, phaseZ: 0.9, speedX: 0.9, speedZ: 0.72 } as const

export function relativePosition(originX: number, originZ: number, influence: InfluencePosition) {
  const differenceX = originX - influence.x
  const differenceZ = originZ - influence.z
  return { differenceX, differenceZ, distanceSquared: differenceX ** 2 + differenceZ ** 2 }
}

export function nearerInfluence(
  current: ReturnType<typeof relativePosition>,
  candidate: ReturnType<typeof relativePosition>,
) {
  return candidate.distanceSquared < current.distanceSquared ? candidate : current
}

export function setVegetationTarget(
  originX: number,
  originZ: number,
  playerPosition: InfluencePosition,
  actors: ReadonlyArray<PositionedInfluence>,
  elapsed: number,
  motionScale: number,
  result: VegetationBend,
) {
  const phase = originX * ambientWind.phaseX + originZ * ambientWind.phaseZ
  const ambientX = Math.sin(elapsed * ambientWind.speedX + phase) * 0.035 * motionScale
  const ambientZ = Math.cos(elapsed * ambientWind.speedZ + phase) * 0.026 * motionScale
  const player = relativePosition(originX, originZ, playerPosition)
  const nearest = actors.reduce(
    (current, actor) => nearerInfluence(current, relativePosition(originX, originZ, actor.position)),
    player,
  )
  if (nearest.distanceSquared >= REACTION_RADIUS ** 2) {
    result.x = ambientX
    result.z = ambientZ
    return result
  }
  const distance = Math.max(0.001, Math.sqrt(nearest.distanceSquared))
  const strength = (1 - distance / REACTION_RADIUS) * 0.48 * motionScale
  const flutter = 0.95 + Math.sin(elapsed * 2.2 + phase) * 0.05
  result.x = (-nearest.differenceZ / distance) * strength * flutter + ambientX
  result.z = (nearest.differenceX / distance) * strength * flutter + ambientZ
  return result
}

export function easeVegetationBend(current: VegetationBend, target: VegetationBend, delta: number): VegetationBend {
  const step = clamp(delta, 0, 0.05)
  current.x = damp(current.x, target.x, 6, step)
  current.z = damp(current.z, target.z, 6, step)
  return current
}
