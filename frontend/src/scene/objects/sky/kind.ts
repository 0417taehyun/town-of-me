import type { TownObjectKind } from '../townObjectKind'
import { BIRD_VARIANTS } from '../variants'
import { SkyLayer } from './SkyLayer'

// Both stay inside the backend's ±120 bounds; birds also stay inside their ±78 flight wrap, so they start where they
// are placed. Neither casts a contact shadow or blocks the player.

export const birdKind: TownObjectKind = {
  category: 'sky',
  defaultColor: '#348ec4',
  addable: true,
  singleton: false,
  sky: { defaultHeight: 7, horizontalLimit: 75 },
  markerRadius: 0.9,
  variants: BIRD_VARIANTS,
  Layer: SkyLayer,
}

export const cloudKind: TownObjectKind = {
  category: 'sky',
  defaultColor: '#ffffff',
  addable: true,
  singleton: false,
  sky: { defaultHeight: 13, horizontalLimit: 110 },
  markerRadius: 2.6,
  Layer: SkyLayer,
}
