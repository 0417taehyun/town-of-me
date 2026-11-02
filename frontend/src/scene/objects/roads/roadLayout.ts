import type { TownObject, TownPoint } from '../../../data/models'
import { clamp01 } from '../../../motionMath'

export const DEFAULT_ROAD_COLOR = '#d7c79f'

export interface TownRoad {
  id: string
  color: string
  width: number
  /** World x/z points. */
  points: TownPoint[]
  /** A code-owned road's request to round the inner corners around it to this radius (townGround.ts). */
  rounding?: number
}

export function getRoadWorldPoints(road: TownObject): TownPoint[] {
  return (road.points ?? []).map(([x, z]) => [road.position.x + x, road.position.z + z] as const)
}

export function getTownRoads(objects: TownObject[]): TownRoad[] {
  return objects
    .filter((object) => object.type === 'road' && (object.points?.length ?? 0) >= 2)
    .map((road) => ({
      id: road.id,
      color: road.color ?? DEFAULT_ROAD_COLOR,
      width: road.width ?? 4,
      points: getRoadWorldPoints(road),
    }))
}

export function quadraticPoint(start: TownPoint, control: TownPoint, end: TownPoint, progress: number): TownPoint {
  const rest = 1 - progress
  const blend = (axis: 0 | 1) =>
    rest * rest * start[axis] + 2 * rest * progress * control[axis] + progress ** 2 * end[axis]
  return [blend(0), blend(1)]
}

export function midpoint([startX, startZ]: TownPoint, [endX, endZ]: TownPoint): TownPoint {
  return [(startX + endX) / 2, (startZ + endZ) / 2]
}

/**
 * Points along a road's middle as the ground painter draws it (townGround.ts drawGround): from the first point, a
 * quadratic curve bent by each inner point to the middle of its span, then straight to the last point.
 */
export function paintedRoadPath(points: readonly TownPoint[], stepsPerCurve = 16): TownPoint[] {
  const curves = points.slice(1, -1).map((control, index) => {
    const start = index === 0 ? points[0] : midpoint(points[index], control)
    const end = midpoint(control, points[index + 2])
    return Array.from({ length: stepsPerCurve }, (_, step) =>
      quadraticPoint(start, control, end, (step + 1) / stepsPerCurve),
    )
  })
  return [points[0], ...curves.flat(), points[points.length - 1]]
}

export function closestPointOnSegment(
  [x, z]: TownPoint,
  [startX, startZ]: TownPoint,
  [endX, endZ]: TownPoint,
): TownPoint {
  const segmentX = endX - startX
  const segmentZ = endZ - startZ
  const along = ((x - startX) * segmentX + (z - startZ) * segmentZ) / (segmentX ** 2 + segmentZ ** 2 || 1)
  const progress = clamp01(along)
  return [startX + segmentX * progress, startZ + segmentZ * progress]
}

/** The point on a road's painted middle closest to `point`. */
export function nearestPointOnRoad(road: TownRoad, point: TownPoint): TownPoint {
  const path = paintedRoadPath(road.points)
  const distance = ([x, z]: TownPoint) => Math.hypot(x - point[0], z - point[1])
  return path
    .slice(1)
    .map((end, index) => closestPointOnSegment(point, path[index], end))
    .reduce((nearest, candidate) => (distance(candidate) < distance(nearest) ? candidate : nearest), path[0])
}
