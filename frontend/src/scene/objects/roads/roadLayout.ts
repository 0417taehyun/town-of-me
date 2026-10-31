import type { TownObject, TownPoint } from '../../../data/models'

export const DEFAULT_ROAD_COLOR = '#d7c79f'

export interface TownRoad {
  id: string
  color: string
  width: number
  /** World x/z points. */
  points: TownPoint[]
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
