import type { TownObject, TownObjectType } from '../data/models'

/**
 * The objects read outside their own layers: by the ground and the map, by the visitor's interactions, and by the
 * atmosphere's falling leaves. The fountain and guestbook board are singletons the town is built around.
 */
export function groupTownObjects(objects: TownObject[]) {
  const byType = (type: TownObjectType) => objects.filter((object) => object.type === type)
  return {
    houses: byType('house'),
    dogHouses: byType('dogHouse'),
    trees: byType('tree'),
    benches: byType('bench'),
    roads: byType('road'),
    fountain: objects.find((object) => object.type === 'fountain'),
    guestbook: objects.find((object) => object.type === 'guestbook'),
  }
}
