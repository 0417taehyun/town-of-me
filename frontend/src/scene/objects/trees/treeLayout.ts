import { seededFraction } from '../../../motionMath'
import type { TownObject } from '../../../data/models'
import { objectVariant, resolveVariant } from '../../objectVariant'
import { getSeasonTreeColor, hasSeasonalTreeEffect, type Season } from '../../environment/season'

export type SeasonalTreeSource = {
  x: number
  z: number
  groundY: number
  dropHeight: number
  scale: number
  treeIndex: number
}

/** A tree shedding its leaves when the season changes, in the colors its crown had. */
export type LeafDropSource = SeasonalTreeSource & { colors: [string, string]; stagger: number }

/** Shared by a crown and the leaves it sheds, so each tree drops its leaves while it changes color. */
export function getTreeStagger(treeIndex: number) {
  return seededFraction(treeIndex, 31)
}

/**
 * How far a crown sways while its tree shakes off its leaves. A still tree must not touch the clock: the opening
 * season's change began at minus infinity, and sin(infinity) × 0 is NaN.
 */
export function getCrownSway(shake: number, elapsed: number, treeIndex: number, scale: number) {
  if (shake === 0) return { x: 0, z: 0 }
  const sway = shake * 0.1 * scale
  return {
    x: Math.sin(elapsed * 24 + treeIndex * 1.7) * sway,
    z: Math.cos(elapsed * 19 + treeIndex * 2.3) * sway * 0.7,
  }
}

export function getTreeLayout(object: TownObject) {
  const scale = (object.scale ?? 1) * 1.18
  return {
    id: object.id,
    scale,
    position: [object.position.x, object.position.y + 1.15 * scale, object.position.z] as [number, number, number],
    halfHeight: 1.15 * scale,
    radius: 0.48 * scale,
  }
}

export function getTreeColliders(objects: TownObject[]) {
  return objects.filter((object) => object.type === 'tree').map(getTreeLayout)
}

export function getTreeSource(object: TownObject, treeIndex: number): SeasonalTreeSource {
  const { scale } = getTreeLayout(object)
  return {
    x: object.position.x,
    z: object.position.z,
    groundY: object.position.y + 0.06,
    dropHeight: object.position.y + 4.65 * scale,
    scale,
    treeIndex,
  }
}

export function getSeasonalTreeSources(objects: TownObject[], season: Season): SeasonalTreeSource[] {
  return objects
    .filter((object) => object.type === 'tree')
    .flatMap((object, treeIndex) =>
      hasSeasonalTreeEffect(season, objectVariant(object.id), resolveVariant(object, 'tree'))
        ? [getTreeSource(object, treeIndex)]
        : [],
    )
}

/** Every tree sheds its leaves before winter; leaving spring for a green season, only the blossoms fall. */
export function getLeafDropSources(objects: TownObject[], from: Season, to: Season): LeafDropSource[] {
  if (from === 'winter' || from === to) return []
  const petalsOnly = from === 'spring' && to !== 'winter'
  return objects
    .filter((object) => object.type === 'tree')
    .flatMap((object, treeIndex) => getLeafDropSource(object, treeIndex, from, petalsOnly))
}

/** A tree's shed leaves in its crown's colors; empty when only blossoms fall and this tree has none. */
export function getLeafDropSource(
  object: TownObject,
  treeIndex: number,
  from: Season,
  petalsOnly: boolean,
): LeafDropSource[] {
  const seed = objectVariant(object.id)
  const variant = resolveVariant(object, 'tree')
  if (petalsOnly && variant !== 'blossoming') return []
  const colors: [string, string] = object.color
    ? [object.color, object.color]
    : [getSeasonTreeColor(from, seed, variant), getSeasonTreeColor(from, seed, variant, true)]
  return [{ ...getTreeSource(object, treeIndex), colors, stagger: getTreeStagger(treeIndex) }]
}
