import { describe, expect, it } from 'vitest'
import {
  BLINK_SECONDS,
  getBlinkAmount,
  getSecondsUntilBlink,
  getSnowFootprintPlacement,
  getSnowFootprintVisibility,
  getTalkingPose,
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

  it('keeps snow footprints by age, then shrinks and expires them', () => {
    expect(getSnowFootprintVisibility(0)).toBe(1)
    expect(getSnowFootprintVisibility(4)).toBe(1)
    expect(getSnowFootprintVisibility(5)).toBe(0.5)
    expect(getSnowFootprintVisibility(6)).toBe(0)
    expect(getSnowFootprintVisibility(20)).toBe(0)
  })

  it('opens the mouth and gently nods only while speaking', () => {
    expect(getTalkingPose(1, false)).toEqual({
      mouthOpen: 0,
      mouthWidth: 1,
      headNod: 0,
      eyeExpression: 'resting',
    })
    expect(getTalkingPose(0, true).mouthOpen).toBeGreaterThan(0.4)
    expect(getTalkingPose(Math.PI / 26, true).mouthOpen).toBeGreaterThan(getTalkingPose(0, true).mouthOpen)
    expect(Math.abs(getTalkingPose(Math.PI / 6.4, true).headNod)).toBeGreaterThan(0.02)
    expect(getTalkingPose(3, true).eyeExpression).toBe('happy')
    expect(getTalkingPose(4.9, true).eyeExpression).toBe('blink')
  })

  it('shuts the eyes fully but briefly every few seconds, at different moments for different seeds', () => {
    const frames = Array.from({ length: 2400 }, (_, frame) => frame)
    const closedFrames = (seed: number) => frames.filter((frame) => getBlinkAmount(frame / 120, seed) > 0.5)
    const blinkCount = (closed: number[]) => closed.filter((frame, index) => closed[index - 1] !== frame - 1).length
    const first = closedFrames(0)
    const second = closedFrames(1)
    expect(Math.max(...frames.map((frame) => getBlinkAmount(frame / 120, 0)))).toBeGreaterThan(0.95)
    expect(first.length).toBeLessThan(frames.length * 0.05)
    expect(blinkCount(first)).toBeGreaterThanOrEqual(3)
    expect(blinkCount(first)).toBeLessThanOrEqual(7)
    expect(second.some((frame) => !first.includes(frame))).toBe(true)
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
