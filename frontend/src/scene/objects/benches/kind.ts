import type { TownObject } from '../../../data/models'
import { patchUnder } from '../../contactShadow'
import { getBenchLayout } from '../../motion/characterPose'
import { placeFootprints, type Footprint } from '../footprints'
import type { TownObjectKind } from '../townObjectKind'
import { BenchesLayer } from './BenchesLayer'

/** The seat, then the backrest behind it. */
export function getBenchFootprints(object: TownObject): Footprint[] {
  const { width, depth } = getBenchLayout(object)
  return [
    [0, 0, width / 2, depth / 2],
    [0, -0.5, width / 2, 0.07],
  ]
}

export function getBenchShadow(bench: TownObject) {
  const { width, depth } = getBenchLayout(bench)
  return patchUnder(bench, width, depth)
}

export const benchKind: TownObjectKind = {
  category: 'props',
  defaultColor: '#a5774e',
  addable: true,
  singleton: false,
  defaults: () => ({ seats: 2 }),
  markerRadius: 1.6,
  Layer: BenchesLayer,
  colliders: (objects) => ({ boxes: placeFootprints(objects, getBenchFootprints) }),
  contactShadows: (objects) => objects.map(getBenchShadow),
}
