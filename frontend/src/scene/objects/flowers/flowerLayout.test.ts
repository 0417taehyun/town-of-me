import { describe, expect, it } from 'vitest'
import { SAMPLE_TOWN } from '../../../testing/sampleTown'
import { getFlowerBloom, getFlowerLayout, getFlowerPose } from './flowerLayout'

describe('flowers under snow', () => {
  it('blooms without snow and closes every flower into a bud under full snow, each at its own moment', () => {
    expect(getFlowerBloom(0, 0.9)).toBe(1)
    expect(getFlowerBloom(1, 0)).toBe(0)
    expect(getFlowerBloom(1, 1)).toBe(0)
    expect(getFlowerBloom(0.4, 0)).toBeLessThan(getFlowerBloom(0.4, 1))
  })

  it('keeps an open flower as laid out and lowers a bud on a shorter stem', () => {
    const layout = getFlowerLayout(SAMPLE_TOWN.objects.find((object) => object.type === 'flower')!)
    expect(getFlowerPose(layout, 1)).toEqual(layout)
    expect(getFlowerPose(layout, 0).height).toBeLessThan(layout.height)
  })
})
