import { describe, expect, it } from 'vitest'
import type { TownObject, TownObjectType } from '../data/models'
import { getFlowerLayout } from './objects/flowers/flowerLayout'
import { createBirdSpecs, getBirdPalette } from './objects/sky/skyMotion'
import { getSeasonalTreeSources } from './objects/trees/treeLayout'
import { resolveVariant } from './objectVariant'

const townObject = (id: string, type: TownObjectType, variant?: string): TownObject => ({
  id,
  type,
  variant,
  position: { x: 0, y: 7, z: 0 },
  rotation: 0,
  scale: 1,
})

const automatic = (type: 'flower' | 'bird' | 'tree', count: number) =>
  Array.from({ length: count }, (_, index) => resolveVariant(townObject(`${type}-${index}`, type), type))

describe('object variants', () => {
  it('draws a saved variant instead of the one the id picks', () => {
    // Left to their ids, these are a tulip, a bluebird, and a tree that blossoms in spring.
    expect(getFlowerLayout(townObject('flower-0', 'flower', 'rose')).kind).toBe('rose')
    const [bird] = createBirdSpecs([townObject('bird-0', 'bird', 'sparrow')])
    expect(bird.species).toBe('sparrow')
    expect(bird.palette).toBe(getBirdPalette('sparrow'))
    expect(getSeasonalTreeSources([townObject('tree-0', 'tree', 'leafy')], 'spring')).toEqual([])
  })

  it('without a saved variant, picks what the id picked before variants could be saved', () => {
    expect(automatic('flower', 4)).toEqual(['tulip', 'sunflower', 'rose', 'daisy'])
    expect(automatic('bird', 8)).toEqual([
      'bluebird',
      'goldfinch',
      'pigeon',
      'robin',
      'pigeon',
      'robin',
      'parakeet',
      'sparrow',
    ])
    expect(automatic('tree', 6)).toEqual(['blossoming', 'blossoming', 'leafy', 'leafy', 'leafy', 'blossoming'])
  })
})
