import { describe, expect, it } from 'vitest'
import { PLAYER_WALK_SPEED } from './playerMotion'
import {
  compensateHipShift,
  createWalkCycle,
  getCyclePose,
  getLowestSole,
  getStrideLength,
  samplePeriodic,
  setPoseOnGround,
  stepWalkCycle,
  type CharacterPose,
} from './walkCycle'

const groundedPose = (phase: number, run: number) => {
  const pose = getCyclePose(phase, run)
  compensateHipShift(pose)
  return setPoseOnGround(pose)
}

describe('key-pose walk and run cycle', () => {
  it('passes through every key exactly and loops smoothly', () => {
    const times = [0, 0.25, 0.5, 0.75]
    const values = [1, 3, -2, 0]
    times.forEach((time, index) => expect(samplePeriodic(times, values, time)).toBeCloseTo(values[index]))
    expect(samplePeriodic(times, values, 0.9999)).toBeCloseTo(values[0], 2)
  })

  it('keeps a sole on the ground all walk long and only leaves it in the run’s flight', () => {
    Array.from({ length: 100 }, (_, index) => index / 100).forEach((phase) => {
      expect(getLowestSole(groundedPose(phase, 0))).toBeCloseTo(0, 6)
      const running = groundedPose(phase, 1)
      expect(getLowestSole(running)).toBeCloseTo(running.lift, 6)
    })
    expect(Math.max(...Array.from({ length: 100 }, (_, index) => groundedPose(index / 100, 1).lift))).toBeGreaterThan(
      0.05,
    )
  })

  it('lands on the left foot first, carries the weight over it, and dips just after contact', () => {
    expect(getCyclePose(0, 0).leftLeg).toBeLessThan(-0.3)
    expect(getCyclePose(0.25, 0).bodyX).toBeLessThan(-0.02)
    expect(getCyclePose(0.75, 0).bodyX).toBeGreaterThan(0.02)
    expect(groundedPose(0.125, 0).bodyY).toBeLessThan(groundedPose(0.3, 0).bodyY)
  })

  it('advances by distance, so the legs keep pace with the ground at any frame rate', () => {
    const atRate = (rate: number) => {
      const cycle = { ...createWalkCycle(), amount: 1 }
      Array.from({ length: rate }, () => stepWalkCycle(cycle, PLAYER_WALK_SPEED, 1 / rate))
      return cycle.phase
    }
    expect(atRate(30)).toBeCloseTo(atRate(144), 6)
    const cycle = { ...createWalkCycle(), amount: 1 }
    stepWalkCycle(cycle, PLAYER_WALK_SPEED, 0.05, PLAYER_WALK_SPEED, false)
    expect(cycle.phase).toBe(0)
  })

  it('takes calmer, longer strides when running and when walking slowly', () => {
    const walking = { ...createWalkCycle(), amount: 1 }
    const stepsPerSecond = (2 * PLAYER_WALK_SPEED) / getStrideLength(walking)
    expect(stepsPerSecond).toBeGreaterThan(4)
    expect(stepsPerSecond).toBeLessThan(6.5)
    const running = { ...createWalkCycle(), amount: 1, run: 1 }
    expect(getStrideLength(running)).toBeGreaterThan(getStrideLength(walking) * 1.5)
  })

  it('eases into standing still when the speed drops to zero', () => {
    const cycle = { ...createWalkCycle(), amount: 1, phase: 0.2 }
    const pose = Array.from({ length: 120 }).reduce<CharacterPose>(
      () => stepWalkCycle(cycle, 0, 1 / 60),
      getCyclePose(0, 0),
    )
    expect(cycle.amount).toBeLessThan(0.01)
    expect(Math.abs(pose.leftLeg)).toBeLessThan(0.01)
    expect(Math.abs(pose.rightKnee - 0.03)).toBeLessThan(0.01)
  })
})
