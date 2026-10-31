import { describe, expect, it } from 'vitest'
import { FENCE_HEIGHT, fenceDistance } from '../game/field'
import { sprayOf } from '../game/flight'
import { createFenceSweep, HEDGE_PROFILE } from './fieldLayout'

describe('stadium hedge', () => {
  it("stands on the judge's fence line and no taller than the fence a home run clears", () => {
    const positions = createFenceSweep(HEDGE_PROFILE, { caps: true }).getAttribute('position')
    const vertices = Array.from({ length: positions.count }, (_, index) => ({
      x: positions.getX(index),
      y: positions.getY(index),
      z: positions.getZ(index),
      onFenceLine: HEDGE_PROFILE[index % HEDGE_PROFILE.length][0] === 0,
    }))
    const fenceLine = vertices.filter((vertex) => vertex.onFenceLine)
    expect(fenceLine.length).toBeGreaterThan(100)
    fenceLine.forEach((vertex) => expect(Math.hypot(vertex.x, vertex.z)).toBeCloseTo(fenceDistance(sprayOf(vertex)), 2))
    vertices.forEach((vertex) => {
      expect(Math.hypot(vertex.x, vertex.z)).toBeGreaterThan(fenceDistance(sprayOf(vertex)) - 0.01)
      expect(vertex.y).toBeLessThanOrEqual(FENCE_HEIGHT + 0.001)
    })
  })
})
