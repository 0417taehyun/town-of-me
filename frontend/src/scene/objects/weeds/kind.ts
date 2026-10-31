import type { TownObjectKind } from '../townObjectKind'
import { WeedsLayer } from './WeedsLayer'

export const weedKind: TownObjectKind = {
  category: 'nature',
  defaultColor: '#5f974b',
  addable: true,
  singleton: false,
  markerRadius: 0.5,
  Layer: WeedsLayer,
}
