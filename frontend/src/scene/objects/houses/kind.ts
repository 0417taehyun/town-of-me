import type { TownObject } from '../../../data/models'
import { patchUnder } from '../../contactShadow'
import { placeFootprints, type Footprint } from '../footprints'
import type { TownObjectKind } from '../townObjectKind'
import { HOUSE_MAILBOX_POSITION, houseLocalPointToWorld } from './houseLayout'
import { HousesLayer } from './HousesLayer'

const HOUSE_FOOTPRINTS: Footprint[] = [
  [0, 0, 2.8, 2.35],
  [HOUSE_MAILBOX_POSITION[0], HOUSE_MAILBOX_POSITION[2], 0.62, 0.48],
]

/** A patch under the house and a small one under its mailbox, which stands apart on the lawn. */
export function getHouseShadows(house: TownObject) {
  const [x, y, z] = houseLocalPointToWorld(house, HOUSE_MAILBOX_POSITION)
  return [patchUnder(house, 5.4, 4.5), patchUnder({ ...house, position: { x, y, z } }, 0.62, 0.5)]
}

export const houseKind: TownObjectKind = {
  category: 'buildings',
  defaultColor: '#e7aa58',
  addable: true,
  singleton: false,
  defaults: (newcomerName) => ({ ownerName: newcomerName }),
  markerRadius: 3.2,
  Layer: HousesLayer,
  colliders: (objects) => ({ boxes: placeFootprints(objects, () => HOUSE_FOOTPRINTS) }),
  contactShadows: (objects) => objects.flatMap(getHouseShadows),
}
