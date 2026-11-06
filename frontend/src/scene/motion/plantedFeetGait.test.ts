import { describe, expect, it } from 'vitest'
import type { GaitInput } from './gait'
import { RESIDENT_WALK_SPEED } from './npcMotion'
import { PLAYER_RUN_SPEED, PLAYER_WALK_SPEED } from './playerMotion'
import { createPlantedFeetGait } from './plantedFeetGait'
import {
  SOLE_POINTS,
  copyPose,
  createRestPose,
  getLegChain,
  getSolePoint,
  setPoseOnGround,
  type CharacterPose,
} from './walkCycle'

const FRAME = 1 / 60
const SIDES = [-1, 1] as const
const HEEL = 0
const TOE = 2

/** Heel, middle, and toe of one shoe in the character's frame, from the pose alone (walkCycle's leg model). */
function getSole(pose: CharacterPose, side: -1 | 1) {
  const chain = getLegChain(pose, side)
  return SOLE_POINTS.map((soleZ) => {
    const point = getSolePoint(chain, soleZ)
    return { y: point.y + pose.bodyY, z: point.z }
  })
}

const isDown = (pose: CharacterPose, side: -1 | 1) => getSole(pose, side).some((point) => point.y < 0.002)

type Frame = { pose: CharacterPose; z: number; footfalls: number }
type Drive = Omit<GaitInput, 'delta'>

function drive(gait: ReturnType<typeof createPlantedFeetGait>, seconds: number, input: (time: number) => Drive) {
  return Array.from({ length: Math.round(seconds / FRAME) }, (_, index): Frame => {
    const frameInput = input(index * FRAME)
    const pose = gait.step({ ...frameInput, delta: FRAME }, createRestPose())
    return { pose, z: frameInput.z, footfalls: gait.footfalls() }
  })
}

const straight =
  (speed: number, walkSpeed: number, start = 0) =>
  (time: number) => ({
    speed,
    walkSpeed,
    advancing: true,
    x: 0,
    z: start + speed * time,
    yaw: 0,
  })

/** Four seconds of a steady straight walk along +z, after a second to settle into it. */
function walk(speed: number, walkSpeed: number) {
  return drive(createPlantedFeetGait(), 5, straight(speed, walkSpeed)).slice(Math.round(1 / FRAME))
}

/** How far soles slide in town while resting on the ground, split into forward and backward. */
function measureSlip(frames: Frame[]) {
  const slides = frames.slice(1).flatMap((frame, index) =>
    SIDES.flatMap((side) => {
      const now = getSole(frame.pose, side)
      const before = getSole(frames[index].pose, side)
      return [HEEL, TOE]
        .filter((point) => now[point].y < 0.002 && before[point].y < 0.002)
        .map((point) => now[point].z + frame.z - before[point].z - frames[index].z)
    }),
  )
  const travel = frames[frames.length - 1].z - frames[0].z
  return {
    forward: slides.filter((slide) => slide > 0).reduce((sum, slide) => sum + slide, 0) / travel,
    backward: -slides.filter((slide) => slide < 0).reduce((sum, slide) => sum + slide, 0) / travel,
  }
}

describe('planted-feet gait', () => {
  it('keeps a foot down all walk long and only leaves the ground in the run’s flight', () => {
    expect(Math.max(...walk(PLAYER_WALK_SPEED, PLAYER_WALK_SPEED).map((frame) => frame.pose.lift))).toBe(0)
    expect(Math.max(...walk(PLAYER_RUN_SPEED, PLAYER_WALK_SPEED).map((frame) => frame.pose.lift))).toBeGreaterThan(0.05)
  })

  it('sets a planted sole exactly on the ground and holds it still in town', () => {
    const frames = walk(RESIDENT_WALK_SPEED, RESIDENT_WALK_SPEED)
    frames.forEach(({ pose }) => {
      expect(setPoseOnGround(copyPose(createRestPose(), pose)).bodyY).toBeCloseTo(pose.bodyY, 4)
    })
    const slip = measureSlip(frames)
    expect(slip.forward + slip.backward).toBeLessThan(0.01)
  })

  it('lets a fast walker’s trailing toe slide forward but never slides a foot back or lands it out of reach', () => {
    const frames = walk(PLAYER_WALK_SPEED, PLAYER_WALK_SPEED)
    const slip = measureSlip(frames)
    expect(slip.backward).toBeLessThan(0.002)
    expect(slip.forward).toBeLessThan(0.4)
    // A landing beyond the leg's reach would leave the foot hanging in the air until the body caught up.
    const touchdownHeights = frames
      .slice(1)
      .flatMap((frame, index) =>
        SIDES.filter((side) => isDown(frame.pose, side) && !isDown(frames[index].pose, side)).map((side) =>
          Math.min(...getSole(frames[index].pose, side).map((point) => point.y)),
        ),
      )
    expect(touchdownHeights.length).toBeGreaterThan(10)
    expect(Math.max(...touchdownHeights)).toBeLessThan(0.03)
  })

  it('re-plants both feet under the hips after a jump', () => {
    const gait = createPlantedFeetGait()
    drive(gait, 1, straight(PLAYER_WALK_SPEED, PLAYER_WALK_SPEED))
    const [{ pose }] = drive(gait, FRAME, straight(PLAYER_WALK_SPEED, PLAYER_WALK_SPEED, 10))
    SIDES.forEach((side) => expect(Math.abs(getSole(pose, side)[1].z)).toBeLessThan(0.1))
  })

  it('slides the feet along instead of stepping while a skid poses the legs', () => {
    const gait = createPlantedFeetGait()
    const before = drive(gait, 1, straight(PLAYER_WALK_SPEED, PLAYER_WALK_SPEED)).pop()!
    const skid = drive(gait, 0.6, (time) => ({
      ...straight(6, PLAYER_WALK_SPEED, before.z)(time),
      advancing: false,
    }))
    expect(skid[skid.length - 1].footfalls).toBe(before.footfalls)
    SIDES.forEach((side) => expect(Math.abs(getSole(skid[skid.length - 1].pose, side)[1].z)).toBeLessThan(0.35))
  })

  it('steps to follow a turn in place, then stands square under the hips', () => {
    const gait = createPlantedFeetGait()
    const standing = (yaw: number) => ({ speed: 0, walkSpeed: RESIDENT_WALK_SPEED, advancing: true, x: 0, z: 0, yaw })
    drive(gait, 0.5, () => standing(0))
    const turn = drive(gait, 1.5, (time) => standing(2 * time))
    const settled = drive(gait, 1, () => standing(3)).pop()!
    expect(turn[turn.length - 1].footfalls).toBeGreaterThanOrEqual(3)
    // A foot within the standing step's 7 cm trigger may stay put.
    expect(Math.abs(settled.pose.leftLegSpread)).toBeLessThan(0.13)
    expect(Math.abs(settled.pose.rightLegSpread)).toBeLessThan(0.13)
    SIDES.forEach((side) => expect(Math.abs(getSole(settled.pose, side)[1].z - 0.02)).toBeLessThan(0.08))
  })
})
