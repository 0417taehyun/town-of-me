import { roundPatchUnder } from '../../contactShadow'
import type { TownObjectKind } from '../townObjectKind'
import { LampsLayer } from './LampsLayer'

const LAMP_POST_RADIUS = 0.18

export const lampKind: TownObjectKind = {
  category: 'props',
  defaultColor: '#485b57',
  addable: true,
  singleton: false,
  markerRadius: 0.7,
  Layer: LampsLayer,
  colliders: (objects) => ({
    circles: objects.map(({ position }) => ({ x: position.x, z: position.z, radius: LAMP_POST_RADIUS })),
  }),
  contactShadows: (objects) => objects.map((lamp) => roundPatchUnder(lamp, 0.55)),
}
