import { describe, expect, it } from 'vitest'
import {
  adjustFovByInputDelta,
  cameraHeightForFov,
  cameraOffset,
  clampYaw,
  dampingAlpha,
  lookAheadOffset,
} from './cameraMath'

describe('camera math', () => {
  it('returns a useful exponential damping alpha', () => {
    expect(dampingAlpha(5, 1 / 60)).toBeGreaterThan(0)
    expect(dampingAlpha(5, 1 / 60)).toBeLessThan(1)
  })

  it('is stable across equal time split into different frame steps', () => {
    const run = (steps: number) => {
      let value = 0
      for (let step = 0; step < steps; step += 1) value += (1 - value) * dampingAlpha(5, 1 / steps)
      return value
    }
    expect(run(30)).toBeCloseTo(run(144), 10)
  })

  it('clamps yaw in both directions', () => {
    expect(clampYaw(2, 0.4)).toBe(0.4)
    expect(clampYaw(-2, 0.4)).toBe(-0.4)
  })

  it('widens FOV for a positive pinch or wheel delta and clamps the result', () => {
    expect(adjustFovByInputDelta(44, 20)).toBeGreaterThan(44)
    expect(adjustFovByInputDelta(44, 100) - 44).toBeLessThan(2)
    expect(adjustFovByInputDelta(57, 100)).toBe(58)
    expect(adjustFovByInputDelta(31, -100)).toBe(30)
  })

  it('keeps close zoom at eye level and smoothly raises a wider view to eight units', () => {
    expect(cameraHeightForFov(30)).toBe(1.7)
    expect(cameraHeightForFov(44)).toBe(1.7)
    expect(cameraHeightForFov(51)).toBeGreaterThan(1.7)
    expect(cameraHeightForFov(51)).toBeLessThan(8)
    expect(cameraHeightForFov(58)).toBe(8)
    expect(cameraHeightForFov(100)).toBe(8)
  })

  it('produces no look-ahead when idle', () => {
    expect(lookAheadOffset(0, 0, 2)).toEqual([0, 0, 0])
  })

  it('preserves horizontal distance and requested height', () => {
    const [x, y, z] = cameraOffset(0.71, 7.5, 9.5)
    expect(Math.hypot(x, z)).toBeCloseTo(9.5)
    expect(y).toBe(7.5)
  })
})
