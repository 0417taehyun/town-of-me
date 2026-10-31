import { describe, expect, it } from 'vitest'
import { getNaturePropLayout } from './naturePropLayout'

describe('nature prop layout', () => {
  it('uses one size factor for the visual, ground offset, and collider', () => {
    const regular = getNaturePropLayout('pumpkin')
    const large = getNaturePropLayout('pumpkin', 1.2)

    expect(large.scale).toBeCloseTo(regular.scale * 1.2)
    expect(large.groundOffset).toBeCloseTo(regular.groundOffset * 1.2)
    expect(large.radius).toBeCloseTo(regular.radius * 1.2)
    expect(large.height).toBeCloseTo(regular.height * 1.2)
  })
})
