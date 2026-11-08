import { describe, expect, it } from 'vitest'
import { PIXEL_RATIO_FACTOR, pixelRatioFor } from './renderQuality'

describe('render quality', () => {
  it('steps the pixel ratio a quarter at a time between 1 and the screen, never past 2', () => {
    const factors = [0, 0.25, 0.5, 0.75, 1]
    expect(factors.map((factor) => pixelRatioFor(factor, 3))).toEqual([1, 1.25, 1.5, 1.75, 2])
    expect(factors.map((factor) => pixelRatioFor(factor, 1.5))).toEqual([1, 1.25, 1.25, 1.5, 1.5])
    expect(factors.map((factor) => pixelRatioFor(factor, 1))).toEqual([1, 1, 1, 1, 1])
    expect(pixelRatioFor(PIXEL_RATIO_FACTOR.start, 3)).toBe(1.5)
  })
})
