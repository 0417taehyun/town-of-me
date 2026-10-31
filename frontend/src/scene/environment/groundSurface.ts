import type { TownObject, TownPoint } from '../../data/models'
import { clamp01 } from '../../motionMath'
import { PLAZA_RADIUS } from '../objects/fountain/fountainLayout'
import type { TownRoad } from '../objects/roads/roadLayout'

/** One of the player's footfalls, for its sound; `snow` is how much snow lies on the town, from 0 to 1. */
export type Footstep = { x: number; z: number; running: boolean; snow: number }

export type GroundSurface = 'grass' | 'path' | 'snow'

/** The paved circle around the fountain, in world x/z. */
export type Plaza = { x: number; z: number; radius: number }

/** Thin snow still sounds like the ground beneath it; from about half cover every step crunches. */
const SNOW_CRUNCH_COVER = 0.5

export function distanceToSegment(x: number, z: number, [startX, startZ]: TownPoint, [endX, endZ]: TownPoint) {
  const segmentX = endX - startX
  const segmentZ = endZ - startZ
  const lengthSquared = segmentX ** 2 + segmentZ ** 2 || 1
  const progress = clamp01(((x - startX) * segmentX + (z - startZ) * segmentZ) / lengthSquared)
  return Math.hypot(x - startX - segmentX * progress, z - startZ - segmentZ * progress)
}

export function isOnRoad(x: number, z: number, { points, width }: TownRoad) {
  return points.slice(1).some((end, index) => distanceToSegment(x, z, points[index], end) <= width / 2)
}

export function getFountainPlaza(fountain: TownObject | undefined): Plaza | null {
  return fountain ? { x: fountain.position.x, z: fountain.position.z, radius: PLAZA_RADIUS * fountain.scale } : null
}

export function getTownPlaza(objects: TownObject[]): Plaza | null {
  return getFountainPlaza(objects.find((object) => object.type === 'fountain'))
}

export function getGroundSurface(step: Footstep, roads: readonly TownRoad[], plaza: Plaza | null): GroundSurface {
  if (step.snow >= SNOW_CRUNCH_COVER) return 'snow'
  if (plaza && Math.hypot(step.x - plaza.x, step.z - plaza.z) <= plaza.radius) return 'path'
  return roads.some((road) => isOnRoad(step.x, step.z, road)) ? 'path' : 'grass'
}
