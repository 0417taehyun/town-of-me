import { describe, expect, it } from 'vitest'
import { Object3D } from 'three'
import {
  advanceAtmosphereTime,
  getAmbientParticleCount,
  getSeasonalParticleCount,
  getSeasonalParticleVisibility,
  LEAVES_PER_TREE,
  setLeafDropTransform,
  setSeasonalParticleTransform,
} from './atmosphereMotion'
import { getSeasonTimeline } from './seasonTransition'

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

  it('uses one seasonal particle system for petals, autumn leaves, and snow', () => {
    const transform = new Object3D()
    for (const season of ['spring', 'autumn', 'winter'] as const) {
      setSeasonalParticleTransform(transform, 12, 0, season)
      const start = transform.position.clone()
      setSeasonalParticleTransform(transform, 12, 1, season)
      expect(transform.position.distanceTo(start)).toBeGreaterThan(0.5)
      expect(transform.position.y).toBeGreaterThan(0)
      expect(transform.position.y).toBeLessThan(19)
    }

    setSeasonalParticleTransform(transform, 12, 1, 'winter')
    expect(transform.scale.x).toBeCloseTo(transform.scale.y)
    setSeasonalParticleTransform(transform, 12, 1, 'spring')
    expect(transform.scale.x).toBeGreaterThan(transform.scale.y)
  })

  it('keeps petals and leaves beneath their source canopy while snow starts in the sky', () => {
    const transform = new Object3D()
    const source = { x: 12, z: -7, groundY: 0.06, dropHeight: 5.2, scale: 1, treeIndex: 3 }
    for (const season of ['spring', 'autumn'] as const) {
      Array.from({ length: 40 }, (_, index) => {
        setSeasonalParticleTransform(transform, index, index * 0.13, season, [source])
        expect(transform.position.y).toBeGreaterThanOrEqual(source.groundY)
        expect(transform.position.y).toBeLessThan(source.dropHeight)
        expect(Math.hypot(transform.position.x - source.x, transform.position.z - source.z)).toBeLessThan(3)
      })
    }
    const winterHeights = Array.from({ length: 24 }, (_, index) => {
      setSeasonalParticleTransform(transform, index, 0, 'winter', [source])
      return transform.position.y
    })
    expect(Math.max(...winterHeights)).toBeGreaterThan(14)
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

  it('lets every shedding tree drop its leaves, which flutter down and lie flat until buried', () => {
    const timeline = getSeasonTimeline('autumn', 'winter', false)
    const source = {
      x: 4,
      z: 2,
      groundY: 0.06,
      dropHeight: 5.5,
      scale: 1.1,
      treeIndex: 0,
      colors: ['#d9472f', '#ffbf26'] as [string, string],
      stagger: 0,
    }
    const transform = new Object3D()
    setLeafDropTransform(transform, 0, -1, [source], timeline)
    expect(transform.scale.x).toBe(0)
    const heights = Array.from({ length: LEAVES_PER_TREE }, (_, index) => {
      setLeafDropTransform(transform, index, 2, [source], timeline)
      return transform.position.y
    })
    expect(Math.max(...heights)).toBeGreaterThan(source.groundY + 0.5)
    setLeafDropTransform(transform, 2, timeline.leavesRestUntil - 0.1, [source], timeline)
    expect(transform.position.y).toBeLessThan(source.groundY + 0.01)
    expect(transform.rotation.x).toBeCloseTo(-Math.PI / 2)
    expect(transform.scale.x).toBeGreaterThan(0)
    expect(Math.hypot(transform.position.x - source.x, transform.position.z - source.z)).toBeLessThan(4)
    setLeafDropTransform(transform, 2, timeline.leavesRestUntil + 3, [source], timeline)
    expect(transform.scale.x).toBe(0)
    setLeafDropTransform(transform, 2, 2, [source], getSeasonTimeline('winter', 'spring', false))
    expect(transform.scale.x).toBe(0)
  })
})
