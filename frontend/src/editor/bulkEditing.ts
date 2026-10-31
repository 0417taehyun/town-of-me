import type { TownObject, TownSnapshot, Vec3 } from '../data/models'
import { clamp, lerp } from '../motionMath'
import { TOWN_OBJECT_KINDS } from '../scene/objects/kinds'
import { clampToTown, createEditorId, getRemovalBlock, townIds, updateObjects, type RemovalBlock } from './townEditing'

export type NumberRange = { minimum: number; maximum: number }

/** What the size and rotation sliders offer, inside what the backend accepts. */
export const SIZE_LIMITS: NumberRange = { minimum: 0.3, maximum: 3 }
export const ROTATION_LIMITS_IN_DEGREES: NumberRange = { minimum: -180, maximum: 180 }

/** How far a copy lands from its original, along X, so a copied group keeps its arrangement. */
export const COPY_OFFSET = 3

/** The value every item shares, or `undefined` when they differ. */
export function getSharedValue<Value>(values: readonly Value[]): Value | undefined {
  return values.every((value) => value === values[0]) ? values[0] : undefined
}

export function offersVariant(object: TownObject, variant: string | undefined) {
  const variants: readonly string[] | undefined = TOWN_OBJECT_KINDS[object.type].variants
  return Boolean(variants && (variant === undefined || variants.includes(variant)))
}

/** Saves the variant on the listed objects whose kind offers it; `undefined` lets each object's id pick again. */
export function setObjectsVariant(town: TownSnapshot, ids: readonly string[], variant: string | undefined) {
  const listed = new Set(ids)
  const offering = town.objects.filter((object) => listed.has(object.id) && offersVariant(object, variant))
  return updateObjects(
    town,
    offering.map(({ id }) => id),
    () => ({ variant }),
  )
}

/** A value drawn evenly between the range's ends, given either way round, once both are held within `limits`. */
export function randomWithin(range: NumberRange, limits: NumberRange, random: () => number) {
  const from = clamp(range.minimum, limits.minimum, limits.maximum)
  const to = clamp(range.maximum, limits.minimum, limits.maximum)
  return lerp(from, to, random())
}

/** Gives each listed object its own size within the range, in hundredths. */
export function randomizeSizes(town: TownSnapshot, ids: readonly string[], range: NumberRange, random = Math.random) {
  return updateObjects(town, ids, () => ({
    scale: Math.round(randomWithin(range, SIZE_LIMITS, random) * 100) / 100,
  }))
}

/** Gives each listed object its own rotation within the range, in whole degrees, stored in radians. */
export function randomizeRotations(
  town: TownSnapshot,
  ids: readonly string[],
  rangeInDegrees: NumberRange,
  random = Math.random,
) {
  return updateObjects(town, ids, () => ({
    rotation: (Math.round(randomWithin(rangeInDegrees, ROTATION_LIMITS_IN_DEGREES, random)) * Math.PI) / 180,
  }))
}

export type ObjectOrigin = { id: string; position: Vec3 }

/** Where the listed objects stand when a drag starts; each frame moves them from here, so clamping never builds up. */
export function getObjectOrigins(town: TownSnapshot, ids: readonly string[]): ObjectOrigin[] {
  const listed = new Set(ids)
  return town.objects.filter(({ id }) => listed.has(id)).map(({ id, position }) => ({ id, position }))
}

/**
 * Moves every object from its origin by the same ground offset, each held within its kind's limits; birds and clouds
 * keep their heights.
 */
export function moveObjects(town: TownSnapshot, origins: readonly ObjectOrigin[], offset: { x: number; z: number }) {
  const starts = new Map(origins.map(({ id, position }) => [id, position]))
  return updateObjects(town, [...starts.keys()], (object) => {
    const start = starts.get(object.id) ?? object.position
    return { position: { x: start.x + offset.x, y: start.y, z: start.z + offset.z } }
  })
}

/** A copy beside the original with an id that is not in `taken`, which the new id then joins. */
export function copyObject(original: TownObject, taken: Set<string>, random: () => number): TownObject {
  const id = createEditorId(original.type, taken, random)
  taken.add(id)
  const position = clampToTown(original.type, { ...original.position, x: original.position.x + COPY_OFFSET })
  return { ...structuredClone(original), id, position }
}

/** Copies each listed object the town may hold more of; the fountain and guestbook board are skipped. */
export function duplicateObjects(town: TownSnapshot, ids: readonly string[], random = Math.random) {
  const listed = new Set(ids)
  const originals = town.objects.filter((object) => listed.has(object.id) && !TOWN_OBJECT_KINDS[object.type].singleton)
  const taken = townIds(town)
  const copies = originals.map((original) => copyObject(original, taken, random))
  return {
    town: copies.length ? { ...town, objects: [...town.objects, ...copies] } : town,
    ids: copies.map(({ id }) => id),
  }
}

/** The listed objects the town has to keep, by reason. */
export function getRemovalBlocks(town: TownSnapshot, ids: readonly string[]): Record<RemovalBlock, string[]> {
  return {
    singleton: ids.filter((id) => getRemovalBlock(town, id) === 'singleton'),
    'bench-in-use': ids.filter((id) => getRemovalBlock(town, id) === 'bench-in-use'),
  }
}

/** Removes the listed objects the town can do without and keeps the ones `getRemovalBlocks` names. */
export function removeObjects(town: TownSnapshot, ids: readonly string[]): TownSnapshot {
  const removable = new Set(ids.filter((id) => !getRemovalBlock(town, id)))
  if (!removable.size) return town
  return { ...town, objects: town.objects.filter(({ id }) => !removable.has(id)) }
}
