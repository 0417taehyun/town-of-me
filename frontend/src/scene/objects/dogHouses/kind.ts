import { patchUnder } from '../../contactShadow'
import { placeFootprints, type Footprint } from '../footprints'
import type { TownObjectKind } from '../townObjectKind'
import { DogHousesLayer } from './DogHousesLayer'

/** The kennel, then its mailbox. */
const DOG_HOUSE_FOOTPRINTS: Footprint[] = [
  [0, 0, 1.2, 0.95],
  [-1.65, 1.05, 0.34, 0.34],
]

export const dogHouseKind: TownObjectKind = {
  category: 'buildings',
  defaultColor: '#d88a43',
  addable: true,
  singleton: false,
  markerRadius: 1.7,
  Layer: DogHousesLayer,
  colliders: (objects) => ({ boxes: placeFootprints(objects, () => DOG_HOUSE_FOOTPRINTS) }),
  contactShadows: (objects) => objects.map((dogHouse) => patchUnder(dogHouse, 2.35, 1.8)),
}
