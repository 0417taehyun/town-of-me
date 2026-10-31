import { Vector3 } from 'three'
import { describe, expect, it } from 'vitest'
import { solveTwoBone } from './twoBoneIk'

const root = new Vector3(0.2, 1.2, -0.1)
const upper = 0.37
const lower = 0.35

function solve(target: Vector3, pole: Vector3, stretch = false) {
  const middle = new Vector3()
  const end = new Vector3()
  const factor = solveTwoBone(root, target, upper, lower, pole, middle, end, stretch)
  return { middle, end, factor }
}

describe('solveTwoBone', () => {
  it('reaches a target in reach with bones of their own length, the middle joint bent toward the pole', () => {
    const target = new Vector3(0.6, 0.9, 0.3)
    for (const pole of [new Vector3(0, -1, 0), new Vector3(1, 0, 0), new Vector3(0, 0.3, -1)]) {
      const { middle, end, factor } = solve(target, pole)
      expect(end.distanceTo(target)).toBeLessThan(1e-9)
      expect(middle.distanceTo(root)).toBeCloseTo(upper, 9)
      expect(end.distanceTo(middle)).toBeCloseTo(lower, 9)
      expect(factor).toBe(1)
      const axis = target.clone().sub(root).normalize()
      const bend = pole.clone().addScaledVector(axis, -pole.dot(axis))
      expect(middle.clone().sub(root).dot(bend)).toBeGreaterThan(0)
    }
  })

  it('points straight at a target out of reach', () => {
    const target = root.clone().add(new Vector3(1.5, -0.4, 0.8))
    const { middle, end, factor } = solve(target, new Vector3(0, -1, 0))
    const toward = target.clone().sub(root).normalize()
    expect(end.clone().sub(root).normalize().dot(toward)).toBeCloseTo(1, 9)
    expect(end.distanceTo(root)).toBeCloseTo(upper + lower, 3)
    expect(middle.clone().sub(root).normalize().dot(toward)).toBeCloseTo(1, 3)
    expect(factor).toBe(1)
  })

  it('stretches both bones evenly to reach a target past them when asked', () => {
    const target = root.clone().add(new Vector3(0.9, 0, 0))
    const { middle, end, factor } = solve(target, new Vector3(0, -1, 0), true)
    expect(end.distanceTo(target)).toBeLessThan(1e-6)
    expect(factor).toBeGreaterThan(1)
    expect(middle.distanceTo(root) / upper).toBeCloseTo(end.distanceTo(middle) / lower, 6)
  })
})
