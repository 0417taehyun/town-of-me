import type { TownObject, TownObjectType } from '../../data/models'
import type { ContactShadowPatch } from '../contactShadow'
import { benchKind } from './benches/kind'
import { dogHouseKind } from './dogHouses/kind'
import { flowerKind } from './flowers/kind'
import { fountainKind } from './fountain/kind'
import { guestbookKind } from './guestbook/kind'
import { houseKind } from './houses/kind'
import { lampKind } from './lamps/kind'
import { bushKind, mushroomKind, pumpkinKind, rockKind } from './natureProps/kind'
import { roadKind } from './roads/kind'
import { birdKind, cloudKind } from './sky/kind'
import type { TownObjectKind } from './townObjectKind'
import { treeKind } from './trees/kind'
import { weedKind } from './weeds/kind'

/** Every kind this build draws. The editor lists each category's kinds in this order. */
export const TOWN_OBJECT_KINDS = {
  house: houseKind,
  road: roadKind,
  tree: treeKind,
  bench: benchKind,
  lamp: lampKind,
  flower: flowerKind,
  weed: weedKind,
  bush: bushKind,
  rock: rockKind,
  mushroom: mushroomKind,
  pumpkin: pumpkinKind,
  dogHouse: dogHouseKind,
  bird: birdKind,
  cloud: cloudKind,
  fountain: fountainKind,
  guestbook: guestbookKind,
} satisfies Record<TownObjectType, TownObjectKind>

/**
 * Each distinct thing `pick` finds on the kinds, in registry order, with every object of the kinds sharing it in
 * town order. Kinds without one are left out; a shared one with no objects yet is kept with none.
 */
export function groupByKind<Shared>(objects: TownObject[], pick: (kind: TownObjectKind) => Shared | undefined) {
  const shared = new Set(Object.values(TOWN_OBJECT_KINDS).map(pick))
  shared.delete(undefined)
  return [...shared].map((value) => ({
    shared: value as Shared,
    objects: objects.filter((object) => pick(TOWN_OBJECT_KINDS[object.type]) === value),
  }))
}

/** Each distinct layer once, with its objects; the list keeps its length and order, so its indices make stable keys. */
export function getTownLayers(objects: TownObject[]) {
  return groupByKind(objects, (kind) => kind.Layer).map((group) => ({ Layer: group.shared, objects: group.objects }))
}

/** One soft patch under each object standing on the ground; footprints follow each layer's own sizes. */
export function getContactShadowLayout(objects: TownObject[]): ContactShadowPatch[] {
  return groupByKind(objects, (kind) => kind.contactShadows).flatMap((group) => group.shared(group.objects))
}
