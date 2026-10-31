import type { TownObject } from '../../data/models'
import type { CollisionBox } from '../townCollision'
import { houseLocalPointToWorld } from './houses/houseLayout'

/** A footprint in its object's own frame: center offset along x and z, then half width and half depth. */
export type Footprint = readonly [offsetX: number, offsetZ: number, halfWidth: number, halfDepth: number]

export function placeFootprint(object: TownObject, [offsetX, offsetZ, halfWidth, halfDepth]: Footprint): CollisionBox {
  const [x, , z] = houseLocalPointToWorld(object, [offsetX, 0, offsetZ])
  return { x, z, halfWidth, halfDepth, cosine: Math.cos(object.rotation), sine: Math.sin(object.rotation) }
}

export function placeFootprints(objects: TownObject[], footprintsOf: (object: TownObject) => Footprint[]) {
  return objects.flatMap((object) => footprintsOf(object).map((footprint) => placeFootprint(object, footprint)))
}
