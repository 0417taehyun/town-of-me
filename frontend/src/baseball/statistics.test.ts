import { describe, expect, it } from 'vitest'
import { median, percentile } from './statistics'

describe('statistics', () => {
  it('takes the middle value, averaging the middle two of an even count, without reordering the input', () => {
    const speeds = [9, 3, 7]
    expect(median(speeds)).toBe(7)
    expect(median([4, 1, 8, 2])).toBe(3)
    expect(speeds).toEqual([9, 3, 7])
  })

  it('reads a percentile between the two nearest sorted values', () => {
    expect(percentile([5, 1, 4, 2, 3], 0.9)).toBeCloseTo(4.6, 9)
    expect(percentile([5, 1, 4, 2, 3], 1)).toBe(5)
  })
})
