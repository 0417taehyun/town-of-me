import { patchUnder } from '../../contactShadow'
import { placeFootprints, type Footprint } from '../footprints'
import type { TownObjectKind } from '../townObjectKind'
import { GuestbookLayer } from './GuestbookLayer'

const GUESTBOOK_FOOTPRINTS: Footprint[] = [[0, 0, 2.3, 0.3]]

// Like its layer, only the town's one board counts.
export const guestbookKind: TownObjectKind = {
  category: 'buildings',
  defaultColor: '#9a6845',
  addable: false,
  singleton: true,
  markerRadius: 2.4,
  Layer: GuestbookLayer,
  colliders: (objects) => ({ boxes: placeFootprints(objects.slice(0, 1), () => GUESTBOOK_FOOTPRINTS) }),
  contactShadows: (objects) => objects.slice(0, 1).map((guestbook) => patchUnder(guestbook, 4.3, 0.5)),
}
