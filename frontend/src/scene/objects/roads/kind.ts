import type { TownObjectKind } from '../townObjectKind'
import { DEFAULT_ROAD_COLOR } from './roadLayout'

// Roads are painted into the ground texture with the plaza, so they have no layer of their own.
export const roadKind: TownObjectKind = {
  category: 'paths',
  defaultColor: DEFAULT_ROAD_COLOR,
  addable: true,
  singleton: false,
  defaults: () => ({
    width: 4,
    color: '#cfbd92',
    points: [
      [-6, 0],
      [6, 0],
    ],
  }),
  markerRadius: 1.3,
}
