import type { TownObjectKind } from '../townObjectKind'
import { FOUNTAIN_RADIUS } from './fountainLayout'
import { FountainLayer } from './FountainLayer'

// Like its layer, only the town's one fountain counts. Its plaza is painted into the ground instead of shadowed.
export const fountainKind: TownObjectKind = {
  category: 'buildings',
  defaultColor: '#b3aa92',
  addable: false,
  singleton: true,
  markerRadius: 2.9,
  Layer: FountainLayer,
  colliders: (objects) => ({
    circles: objects
      .slice(0, 1)
      .map(({ position, scale }) => ({ x: position.x, z: position.z, radius: FOUNTAIN_RADIUS * scale })),
  }),
}
