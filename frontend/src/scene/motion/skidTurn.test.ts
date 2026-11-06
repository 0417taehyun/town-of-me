import { describe, expect, it } from 'vitest'
import { PLAYER_RUN_SPEED, PLAYER_WALK_SPEED } from './playerMotion'
import { createPlayerMovement, stepPlayerMovement, type PlayerMovement } from './skidTurn'

const frame = 1 / 60

/** Steps as the Player does: the physics body moves exactly as told, so the measured velocity is the last one. */
function run(movement: PlayerMovement, direction: { x: number; z: number }, speed: number, seconds: number) {
  const events: string[] = []
  Array.from({ length: Math.round(seconds / frame) }, () => {
    stepPlayerMovement(movement, direction, speed, frame, { ...movement.velocity })
    events.push(...movement.events.map(({ type, quiet }) => (quiet ? `${type} (quiet)` : type)))
    movement.events.length = 0
  })
  return events
}

const runningNorth = () => {
  const movement = createPlayerMovement()
  run(movement, { x: 0, z: 1 }, PLAYER_RUN_SPEED, 1.5)
  return movement
}

describe('the skid turn and brake', () => {
  it('turns to face the new way at once, slides on backwards, then sets off', () => {
    const movement = runningNorth()
    expect(run(movement, { x: 0, z: -1 }, PLAYER_RUN_SPEED, frame)).toEqual(['skid'])
    run(movement, { x: 0, z: -1 }, PLAYER_RUN_SPEED, 0.15)
    // Half way round, so the face is seen turning rather than snapping.
    expect(Math.abs(movement.yaw)).toBeGreaterThan(Math.PI * 0.3)
    expect(Math.abs(movement.yaw)).toBeLessThan(Math.PI * 0.7)
    run(movement, { x: 0, z: -1 }, PLAYER_RUN_SPEED, 0.17)
    expect(Math.abs(movement.yaw)).toBeCloseTo(Math.PI, 2)
    expect(movement.velocity.z).toBeGreaterThan(0)
    expect(run(movement, { x: 0, z: -1 }, PLAYER_RUN_SPEED, 0.13)).toEqual(['launch'])
    expect(movement.velocity.z).toBeLessThan(-0.4 * PLAYER_RUN_SPEED)
  })

  it('stops facing the new way when the input is let go mid-slide', () => {
    const movement = runningNorth()
    run(movement, { x: 0, z: -1 }, PLAYER_RUN_SPEED, 0.32)
    expect(run(movement, { x: 0, z: 0 }, PLAYER_RUN_SPEED, 0.2)).toEqual(['settle'])
    expect(Math.abs(movement.yaw)).toBeCloseTo(Math.PI, 2)
    expect(movement.velocity.z).toBe(0)
  })

  it('turns round without skidding or braking when skids are off, and slides less with short skids', () => {
    const plain = runningNorth()
    plain.style = 'off'
    expect(run(plain, { x: 0, z: -1 }, PLAYER_RUN_SPEED, 1)).toEqual([])
    expect(plain.velocity.z).toBeLessThan(-PLAYER_RUN_SPEED * 0.9)
    const short = runningNorth()
    short.style = 'short'
    expect(run(short, { x: 0, z: -1 }, PLAYER_RUN_SPEED, 0.3)).toEqual(['skid', 'launch'])
  })

  it('just turns round when walking', () => {
    const movement = createPlayerMovement()
    run(movement, { x: 0, z: 1 }, PLAYER_WALK_SPEED, 1)
    expect(run(movement, { x: 0, z: -1 }, PLAYER_WALK_SPEED, 1)).toEqual([])
    expect(movement.velocity.z).toBeLessThan(-PLAYER_WALK_SPEED * 0.9)
  })

  it('brakes to a stop when letting go at a run, then rocks once and stands', () => {
    const movement = runningNorth()
    expect(run(movement, { x: 0, z: 0 }, PLAYER_WALK_SPEED, frame)).toEqual(['brake'])
    run(movement, { x: 0, z: 0 }, PLAYER_WALK_SPEED, 0.3)
    expect(movement.velocity.z).toBeGreaterThan(0)
    expect(movement.velocity.z).toBeLessThan(4)
    expect(run(movement, { x: 0, z: 0 }, PLAYER_WALK_SPEED, 0.2)).toEqual(['settle'])
    expect(movement.velocity.z).toBe(0)
    expect(Math.abs(movement.settlePitch)).toBeGreaterThan(0.05)
    run(movement, { x: 0, z: 0 }, PLAYER_WALK_SPEED, 0.5)
    expect(movement.mode).toBe('move')
  })

  it('turns a keyboard reversal, which lets go for a frame, into the same skid without a second squeal', () => {
    const movement = runningNorth()
    expect(run(movement, { x: 0, z: 0 }, PLAYER_RUN_SPEED, frame)).toEqual(['brake'])
    expect(run(movement, { x: 0, z: -1 }, PLAYER_RUN_SPEED, frame)).toEqual(['skid (quiet)'])
    expect(movement.mode).toBe('skid')
  })
})
