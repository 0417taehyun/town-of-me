import type { TownObject } from '../data/models'
import type { BirdVariant, FlowerVariant, TreeVariant } from './objects/variants'

/** A stable number per object id for visual variety, so adding or removing one object never restyles the others. */
export function objectVariant(id: string) {
  let hash = 2166136261
  for (const character of id) hash = Math.imul(hash ^ (character.codePointAt(0) ?? 0), 16777619)
  return hash >>> 0
}

type VariantOf = { flower: FlowerVariant; bird: BirdVariant; tree: TreeVariant }

// Frozen copies of the lists as they were when variants became savable: a variant added later is used only when the
// admin picks it, so objects without a saved variant never change their look.
const automaticFlowers: readonly FlowerVariant[] = ['sunflower', 'rose', 'daisy', 'tulip']
const automaticBirds: readonly BirdVariant[] = ['sparrow', 'pigeon', 'robin', 'bluebird', 'goldfinch', 'parakeet']

/** What an object without a saved variant is drawn as: what its id picked before variants could be saved. */
const automaticVariants: { [Type in keyof VariantOf]: (seed: number) => VariantOf[Type] } = {
  flower: (seed) => automaticFlowers[seed % automaticFlowers.length],
  bird: (seed) => automaticBirds[seed % automaticBirds.length],
  tree: (seed) => (seed % 4 === 3 || seed % 8 === 0 ? 'blossoming' : 'leafy'),
}

/**
 * How every renderer draws `object` of `type`: its saved variant, or else the one its id picks, so a town saved
 * without variants keeps its look. The town's parser has already dropped any variant this build cannot draw.
 */
export function resolveVariant<Type extends keyof VariantOf>(object: TownObject, type: Type) {
  return (object.variant ?? automaticVariants[type](objectVariant(object.id))) as VariantOf[Type]
}
