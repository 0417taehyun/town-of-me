import { describe, expect, it } from 'vitest'
import { Object3D } from 'three'
import {
  advanceAtmosphereTime,
  getAmbientParticleCount,
  getSeasonalParticleCount,
  getSeasonalParticleVisibility,
  setSeasonalParticleTransform,
} from './atmosphereMotion'

function advanceSeconds(seconds: number, reduced: boolean) {
  return Array.from({ length: seconds * 60 }).reduce<number>((time) => advanceAtmosphereTime(time, 1 / 60, reduced), 0)
}

describe('atmosphere motion and falling particles', () => {
  it('reduces rather than freezes OS reduced motion; only the explicit switch freezes time', () => {
    expect(advanceSeconds(10, false)).toBeCloseTo(10)
    expect(advanceSeconds(10, true)).toBeCloseTo(2.8)
    expect(advanceAtmosphereTime(5, 1 / 60, false, false)).toBe(5)
    expect(advanceAtmosphereTime(0, 20, false)).toBe(0.1)
    expect(advanceAtmosphereTime(0, -1, false)).toBe(0)
  })

  it('hands falling particles to the next season without popping them in or out beside a tree', () => {
    const transform = new Object3D()
    const source = { x: 12, z: -7, groundY: 0.06, dropHeight: 5.2, scale: 1, treeIndex: 3 }
    expect(getAmbientParticleCount('autumn', [])).toBe(0)
    expect(getAmbientParticleCount('winter', [])).toBe(getSeasonalParticleCount('winter'))
    const fallingFor = setSeasonalParticleTransform(transform, 5, 40, 'autumn', [source])
    expect(fallingFor).toBeGreaterThanOrEqual(0)
    expect(fallingFor).toBeLessThan((source.dropHeight - source.groundY) / 1.75 + 0.01)
    const gate = { start: 40 - fallingFor - 0.5, end: 40 - fallingFor - 0.5 }
    expect(getSeasonalParticleVisibility(5, 40, fallingFor, null, true, 'autumn')).toBe(1)
    // The leaf set off after its moment, so it joins and is no longer one of the leaving season's.
    expect(getSeasonalParticleVisibility(5, 40, fallingFor, gate, true, 'autumn')).toBe(1)
    expect(getSeasonalParticleVisibility(5, 40, fallingFor, gate, false, 'autumn')).toBe(0)
    const snowGate = { start: 10, end: 10 }
    expect(getSeasonalParticleVisibility(5, 10.6, 3, snowGate, true, 'winter')).toBeCloseTo(0.5)
    expect(getSeasonalParticleVisibility(5, 10.6, 3, snowGate, false, 'winter')).toBeCloseTo(0.5)
  })
})
