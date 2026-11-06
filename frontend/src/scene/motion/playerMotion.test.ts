import { describe, expect, it } from 'vitest'
import {
  BLINK_SECONDS,
  getBlinkAmount,
  getSecondsUntilBlink,
  getSnowFootprintPlacement,
  getSnowFootprintVisibility,
  PLAYER_RUN_SPEED,
  PLAYER_WALK_SPEED,
  smoothPlayerVelocity,
} from './playerMotion'

describe('smooth player locomotion', () => {
  it('places alternating snow footprints beside the travel line and ignores idle or teleport motion', () => {
    const left = getSnowFootprintPlacement({ x: 0, z: 0 }, { x: 0, z: 1 }, -1)
    const right = getSnowFootprintPlacement({ x: 0, z: 0 }, { x: 0, z: 1 }, 1)
    expect(left?.x).toBeGreaterThan(0)
    expect(right?.x).toBeLessThan(0)
    expect(left?.rotation).toBeCloseTo(0)
    expect(getSnowFootprintPlacement({ x: 0, z: 0 }, { x: 0, z: 0.2 }, 1)).toBeNull()
    expect(getSnowFootprintPlacement({ x: 0, z: 0 }, { x: 20, z: 20 }, 1)).toBeNull()
  })

  it.each([
    [0, 0],
    [1, 2.2],
    [7.3, 9.81],
  ])('knows when the next blink of seed %d starts after %d s, so an on-demand preview can draw it', (seed, elapsed) => {
    const wait = getSecondsUntilBlink(elapsed, seed)
    expect(getBlinkAmount(elapsed + wait - 0.02, seed)).toBe(0)
    expect(getBlinkAmount(elapsed + wait + BLINK_SECONDS / 2, seed)).toBeGreaterThan(0.95)
  })

  it('keeps snow footprints by age, then shrinks and expires them', () => {
    expect(getSnowFootprintVisibility(0)).toBe(1)
    expect(getSnowFootprintVisibility(4)).toBe(1)
    expect(getSnowFootprintVisibility(5)).toBe(0.5)
    expect(getSnowFootprintVisibility(6)).toBe(0)
    expect(getSnowFootprintVisibility(20)).toBe(0)
  })

  it('eases walk-to-run and release velocities without a one-frame jump', () => {
    const run = smoothPlayerVelocity(0, PLAYER_WALK_SPEED, 0, PLAYER_RUN_SPEED, 1 / 60)
    expect(run.z).toBeGreaterThan(PLAYER_WALK_SPEED)
    expect(run.z - PLAYER_WALK_SPEED).toBeLessThan((PLAYER_RUN_SPEED - PLAYER_WALK_SPEED) * 0.12)
    const stop = smoothPlayerVelocity(0, PLAYER_RUN_SPEED, 0, 0, 1 / 60)
    expect(stop.z).toBeGreaterThan(PLAYER_RUN_SPEED * 0.8)
    expect(stop.z).toBeLessThan(PLAYER_RUN_SPEED)
  })
  it('keeps acceleration and braking frame-rate independent at 30/60/144 fps', () => {
    const atRate = (rate: number) => {
      const velocity = { x: 0, z: 0 }
      Array.from({ length: rate }).forEach(() =>
        smoothPlayerVelocity(velocity.x, velocity.z, 0, PLAYER_RUN_SPEED, 1 / rate, velocity),
      )
      const peak = velocity.z
      Array.from({ length: rate / 2 }).forEach(() =>
        smoothPlayerVelocity(velocity.x, velocity.z, 0, 0, 1 / rate, velocity),
      )
      return { peak, stopped: velocity.z }
    }
    const baseline = atRate(60)
    expect(atRate(30).peak).toBeCloseTo(baseline.peak, 6)
    expect(atRate(144).peak).toBeCloseTo(baseline.peak, 6)
    expect(atRate(30).stopped).toBeCloseTo(baseline.stopped, 6)
    expect(atRate(144).stopped).toBeCloseTo(baseline.stopped, 6)
    expect(baseline.stopped).toBeLessThan(PLAYER_RUN_SPEED * 0.01)
  })
})
