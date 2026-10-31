import type { TownObjectKind } from '../townObjectKind'
import { FLOWER_VARIANTS } from '../variants'
import { FlowersLayer } from './FlowersLayer'

export const flowerKind: TownObjectKind = {
  category: 'nature',
  defaultColor: '#ef476f',
  addable: true,
  singleton: false,
  markerRadius: 0.5,
  variants: FLOWER_VARIANTS,
  Layer: FlowersLayer,
}
