import { describe, expect, it } from 'vitest'
import { easeVegetationBend, setVegetationTarget } from './vegetationMotion'

describe('pass-through vegetation motion', () => {
  it('bends away from the nearest player or actor and keeps a gentle ambient sway at distance', () => {
    const target = { x: 0, z: 0 }
    setVegetationTarget(0, 0, { x: 0, z: -1 }, [{ position: { x: 20, z: 20 } }], 0, 1, target)
    expect(target.x).toBeLessThan(0)
    expect(Math.abs(target.z)).toBeLessThan(0.03)
    setVegetationTarget(0, 0, { x: 20, z: 20 }, [], 1, 1, target)
    expect(Math.abs(target.x) + Math.abs(target.z)).toBeGreaterThan(0)
    expect(Math.abs(target.x) + Math.abs(target.z)).toBeLessThan(0.08)
  })

  it('eases into contact and springs back without snapping', () => {
    const bend = { x: 0, z: 0 }
    easeVegetationBend(bend, { x: 0.4, z: -0.2 }, 1 / 60)
    expect(bend.x).toBeGreaterThan(0)
    expect(bend.x).toBeLessThan(0.4)
    const peak = bend.x
    easeVegetationBend(bend, { x: 0, z: 0 }, 1 / 60)
    expect(bend.x).toBeLessThan(peak)
    expect(bend.x).toBeGreaterThan(0)
  })
})
