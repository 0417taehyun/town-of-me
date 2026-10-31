// The named looks an object can be saved with. The town's parser reads these lists from the main chunk, so this module
// holds only data; `resolveVariant` in `scene/objectVariant.ts` turns an object into the variant it is drawn as.

export const FLOWER_VARIANTS = ['sunflower', 'rose', 'daisy', 'tulip'] as const
export const BIRD_VARIANTS = ['sparrow', 'pigeon', 'robin', 'bluebird', 'goldfinch', 'parakeet'] as const
/** A blossoming tree turns pink in spring and sheds its petals; a leafy one stays green. */
export const TREE_VARIANTS = ['leafy', 'blossoming'] as const

export type FlowerVariant = (typeof FLOWER_VARIANTS)[number]
export type BirdVariant = (typeof BIRD_VARIANTS)[number]
export type TreeVariant = (typeof TREE_VARIANTS)[number]
export type TownObjectVariant = FlowerVariant | BirdVariant | TreeVariant
