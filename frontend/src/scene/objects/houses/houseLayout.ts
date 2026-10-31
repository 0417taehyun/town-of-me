import type { Vector3Tuple } from 'three'
import type { TownObject } from '../../../data/models'

export const HOUSE_DOOR_POSITION: Vector3Tuple = [0, 0.9, 2.28]
export const HOUSE_STEP_POSITION: Vector3Tuple = [0, 0.12, 2.65]
export const HOUSE_MAILBOX_POSITION: Vector3Tuple = [-3.65, 0, 3]

export function houseLocalPointToWorld(object: TownObject, [localX, localY, localZ]: Vector3Tuple): Vector3Tuple {
  const rotation = object.rotation
  const cosine = Math.cos(rotation)
  const sine = Math.sin(rotation)
  return [
    object.position.x + localX * cosine + localZ * sine,
    object.position.y + localY,
    object.position.z - localX * sine + localZ * cosine,
  ]
}

export function getHouseApproachPosition(object: TownObject) {
  return houseLocalPointToWorld(object, [0, 0, 3.4])
}

export function getHouseTitle(object: TownObject) {
  return object.ownerName ? `${object.ownerName}'s House` : 'Town house'
}
