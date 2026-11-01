import { Color, Object3D } from 'three'
import { describe, expect, it } from 'vitest'
import { MOUND_DISTANCE } from '../game/field'
import {
  BREEZE_COUNTS,
  burstPetals,
  createPetalPool,
  homeRunBurstDue,
  poseDriftPetal,
  sightClearance,
} from './breezeLayout'

const noBall = { eye: { x: 0, y: 1.6, z: 6 }, ball: null }

describe('the garden breeze', () => {
  it('keeps every drifting petal off the pitch and in front of the batting camera at any moment', () => {
    const petal = new Object3D()
    const nearest = Array.from({ length: 400 }, (_, step) => step * 1.37).flatMap((elapsed) =>
      Array.from({ length: BREEZE_COUNTS.full.drift }, (_, index) => {
        poseDriftPetal(petal, index, elapsed, noBall)
        return { distance: Math.hypot(petal.position.x, petal.position.z), z: petal.position.z }
      }),
    )
    expect(Math.min(...nearest.map((spot) => spot.distance))).toBeGreaterThan(MOUND_DISTANCE + 10)
    expect(Math.max(...nearest.map((spot) => spot.z))).toBeLessThan(0)
  })

  it('hides what lies on the camera’s line to the ball and nothing well clear of it', () => {
    const sight = { eye: { x: 0, y: 2, z: 6 }, ball: { x: 0, y: 12, z: -60 } }
    expect(sightClearance({ x: 0, y: 7, z: -27 }, sight)).toBe(0)
    expect(sightClearance({ x: 5, y: 7, z: -27 }, sight)).toBe(1)
    expect(sightClearance({ x: 0, y: 7, z: -27 }, { ...sight, ball: null })).toBe(1)
  })

  it('bursts once a home run’s ball is past the hedge, and only once', () => {
    const over = { flying: true, position: { x: 0, y: 8, z: -95 } }
    const short = { flying: true, position: { x: 0, y: 8, z: -85 } }
    expect(homeRunBurstDue(true, false, short)).toBe(false)
    expect(homeRunBurstDue(true, false, over)).toBe(true)
    expect(homeRunBurstDue(true, true, over)).toBe(false)
    expect(homeRunBurstDue(false, false, over)).toBe(false)
  })

  it('takes over the oldest petals when bursts outgrow the pool', () => {
    const pool = createPetalPool(8)
    const colors = [new Color('#ffffff')]
    burstPetals(pool, { x: 0, y: 5, z: -90 }, 6, colors, 0)
    burstPetals(pool, { x: 40, y: 5, z: -90 }, 6, colors, 1)
    const fromSecond = Array.from({ length: 8 }, (_, index) => pool.positions[index * 3] === 40)
    expect(fromSecond).toEqual([true, true, true, true, false, false, true, true])
  })
})
