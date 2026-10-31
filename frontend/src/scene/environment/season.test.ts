import { describe, expect, it } from 'vitest'
import { TREE_VARIANTS } from '../objects/variants'
import { getSeason, getSeasonTreeColor, hasSeasonalTreeEffect, seasonPalettes } from './season'

describe('local northern-hemisphere season', () => {
  it('uses autumn throughout September, October and November', () => {
    expect(getSeason(new Date(2026, 8, 1))).toBe('autumn')
    expect(getSeason(new Date(2026, 9, 4))).toBe('autumn')
    expect(getSeason(new Date(2026, 10, 30))).toBe('autumn')
    expect(getSeason(new Date(2026, 11, 1))).toBe('winter')
  })

  it('uses cherry blossom colors on exactly the spring trees that drop petals, whatever their seed', () => {
    const trees = TREE_VARIANTS.flatMap((variant) => Array.from({ length: 24 }, (_, seed) => ({ seed, variant })))
    trees.forEach(({ seed, variant }) => {
      const blossoms = hasSeasonalTreeEffect('spring', seed, variant)
      expect(getSeasonTreeColor('spring', seed, variant) === seasonPalettes.spring.treeCrowns.at(-1)).toBe(blossoms)
      expect(getSeasonTreeColor('spring', seed, variant, true) === seasonPalettes.spring.treeTops.at(-1)).toBe(blossoms)
    })
  })
})
