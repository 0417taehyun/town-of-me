import type { TownObject } from '../../../data/models'
import { roundPatchUnder } from '../../contactShadow'
import type { CollisionCircle } from '../../townCollision'
import type { TownObjectKind } from '../townObjectKind'
import { getNaturePropLayout, type NaturePropKind } from './naturePropLayout'
import { NaturePropsLayer } from './NaturePropsLayer'

export function getSolidPropCircles(natureProps: TownObject[]): CollisionCircle[] {
  return natureProps
    .map((object) => ({ object, layout: getNaturePropLayout(object.type as NaturePropKind, object.scale) }))
    .filter(({ layout }) => layout.solid)
    .map(({ object, layout }) => ({ x: object.position.x, z: object.position.z, radius: layout.radius }))
}

export function getNaturePropShadow(prop: TownObject) {
  return roundPatchUnder(prop, getNaturePropLayout(prop.type as NaturePropKind, prop.scale).radius * 2)
}

// The four kinds share one layer, collider, and shadow function, so each runs once over all of them in town order.
// Their models are tinted, so white leaves them as modeled.
const naturePropKind = {
  category: 'nature',
  defaultColor: '#ffffff',
  addable: true,
  singleton: false,
  Layer: NaturePropsLayer,
  colliders: (objects) => ({ circles: getSolidPropCircles(objects) }),
  contactShadows: (objects) => objects.map(getNaturePropShadow),
} satisfies Omit<TownObjectKind, 'markerRadius'>

export const rockKind: TownObjectKind = { ...naturePropKind, markerRadius: 1.2 }
export const bushKind: TownObjectKind = { ...naturePropKind, markerRadius: 1 }
export const mushroomKind: TownObjectKind = { ...naturePropKind, markerRadius: 0.8 }
export const pumpkinKind: TownObjectKind = { ...naturePropKind, markerRadius: 0.8 }
