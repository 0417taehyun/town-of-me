import { Color } from 'three'
import { describe, expect, it } from 'vitest'
import { burstPetals, createPetalPool, homeRunBurstDue } from './breezeLayout'

describe('the garden breeze', () => {
  it('bursts once a home run’s ball is past the hedge, and only once', () => {
    const over = { flying: true, position: { x: 0, y: 8, z: -95 } }
    const short = { flying: true, position: { x: 0, y: 8, z: -85 } }
    expect(homeRunBurstDue(true, false, short)).toBe(false)
    expect(homeRunBurstDue(true, false, over)).toBe(true)
    expect(homeRunBurstDue(true, true, over)).toBe(false)
    expect(homeRunBurstDue(false, false, over)).toBe(false)
  })

  it('takes over the oldest petals when bursts outgrow the pool', () => {
    const pool = createPetalPool(8)
    const colors = [new Color('#ffffff')]
    burstPetals(pool, { x: 0, y: 5, z: -90 }, 6, colors, 0)
    burstPetals(pool, { x: 40, y: 5, z: -90 }, 6, colors, 1)
    const fromSecond = Array.from({ length: 8 }, (_, index) => pool.positions[index * 3] === 40)
    expect(fromSecond).toEqual([true, true, true, true, false, false, true, true])
  })
})
