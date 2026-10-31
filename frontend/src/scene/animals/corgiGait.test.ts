import { Group } from 'three'
import { describe, expect, it } from 'vitest'
import { getCorgiGait, getDefaultPetRoute, walkCorgiRoute } from './corgiGait'

describe('corgi walk', () => {
  it('walks the default loop around wherever the fountain stands, without leaving the ground', () => {
    const aroundCenter = getDefaultPetRoute()
    expect(getDefaultPetRoute({ x: 10, y: 0, z: -6 })).toEqual(aroundCenter.map(([x, z]) => [x + 10, z - 6]))
    expect(Math.max(...getDefaultPetRoute({ x: 45, y: 0, z: 0 }).map(([x]) => x))).toBe(52)
  })

  it('trots toward the next point of the route it is given, even after that route shrinks', () => {
    const node = new Group()
    const route = [
      [0, 0],
      [10, 0],
      [0, 10],
    ] as const
    expect(walkCorgiRoute(node, { routeIndex: 4, waitUntil: 0, speed: 0 }, route, 1, 0.05)).toBe(true)
    expect(node.position.x).toBeGreaterThan(0)
    expect(node.position.z).toBe(0)
  })
})

describe('corgi quadruped gait', () => {
  it.each([0, 0.04, 0.09, 0.2])('moves diagonal pairs together, with the other pair planted at %s', (time) => {
    const gait = getCorgiGait(time, 1, false, false)
    expect(gait.angles[0]).toBeCloseTo(gait.angles[3])
    expect(gait.angles[1]).toBeCloseTo(gait.angles[2])
    expect(gait.angles[0]).toBeCloseTo(-gait.angles[1])
    expect(gait.lifts[0]).toBeCloseTo(gait.lifts[3])
    expect(gait.lifts[1]).toBeCloseTo(gait.lifts[2])
    expect(Math.min(gait.lifts[0], gait.lifts[1])).toBeCloseTo(0)
  })

  it('plants all four feet while idle or being petted, with no body bounce', () => {
    const idle = getCorgiGait(0.06, 0, false, false)
    const pet = getCorgiGait(0.06, 0, true, false)
    expect(idle.angles).toEqual([0, 0, 0, 0])
    expect(pet.lifts).toEqual([0, 0, 0, 0])
    expect(pet.bodyY).toBe(0)
    expect(Math.abs(pet.tailWag)).toBeGreaterThan(Math.abs(idle.tailWag))
  })

  it('reuses the frame result and reduces decorative motion without losing the walking gait', () => {
    const normal = getCorgiGait(0.06, 1, false, false)
    const target = getCorgiGait(0, 0, false, false)
    const angles = target.angles
    const reduced = getCorgiGait(0.06, 1, false, true, target)
    expect(reduced).toBe(target)
    expect(reduced.angles).toBe(angles)
    expect(reduced.angles).toEqual(normal.angles)
    expect(reduced.bodyY).toBeCloseTo(normal.bodyY * 0.3)
  })

  it('blends into the gait instead of snapping every limb to a full stride', () => {
    const full = getCorgiGait(0.04, 1, false, false)
    const half = getCorgiGait(0.04, 0.5, false, false)
    expect(half.angles[0]).toBeCloseTo(full.angles[0] * 0.5)
    expect(half.lifts[0]).toBeCloseTo(full.lifts[0] * 0.5)
  })
})
