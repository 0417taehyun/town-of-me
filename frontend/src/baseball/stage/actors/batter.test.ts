import { Vector3 } from 'three'
import { describe, expect, it } from 'vitest'
import type { Vec3 } from '../../../data/models'
import { DEFAULT_PLAYER_PROFILE, type PlayerProfile } from '../../../data/playerProfile'
import type { BattingSide } from '../../game/field'
import {
  contactSeconds,
  meetSeconds,
  PITCH_TYPE_IDS,
  type PitchTypeId,
  pitchPosition,
  planPitch,
} from '../../game/pitch'
import { PITCH_TARGET_BAND } from '../../game/pitchSchedule'
import { PLAYER_SCALE } from '../stageLayout'
import { BAT } from './bat'
import { type Batter, batInHead, batterPoseAt, createBatter, poseBatter, startSwing } from './batter'
import { CONTACT_DELAY_MS, FINISH_HOLD_MS, RETURN_MS, SWING_KEY_TIMES, SWING_MS } from './swingMotion'

const sides: BattingSide[] = ['right', 'left']

/** Where a pitch aimed at `corner` is met by a swing `timingSeconds` off PERFECT (early swings meet it further out). */
function meetPoint(type: PitchTypeId, corner: { x: number; y: number }, timingSeconds: number) {
  const plan = planPitch(type, 0.5, corner)
  return pitchPosition(plan, meetSeconds(plan, contactSeconds(plan) + timingSeconds))
}

const corners = [
  { x: -PITCH_TARGET_BAND.side, y: PITCH_TARGET_BAND.low },
  { x: PITCH_TARGET_BAND.side, y: PITCH_TARGET_BAND.high },
  { x: -PITCH_TARGET_BAND.side, y: PITCH_TARGET_BAND.high },
  { x: PITCH_TARGET_BAND.side, y: PITCH_TARGET_BAND.low },
]
const timings = [-0.2, 0, 0.2]
const meetPoints = PITCH_TYPE_IDS.flatMap((type) =>
  corners.flatMap((corner) => timings.map((timing) => meetPoint(type, corner, timing))),
)

function worldSweetSpot(batter: Batter) {
  batter.rig.root.updateMatrixWorld(true)
  return batter.bat.localToWorld(new Vector3(0, BAT.sweetSpot, 0))
}

function poseAt(batter: Batter, nowMs: number, load: number) {
  poseBatter(batter, batterPoseAt(batter, nowMs, load, false))
  batter.rig.root.updateMatrixWorld(true)
}

/** The deepest the bat reaches into the head through the windup, in meters. */
function deepestInWindup(batter: Batter) {
  const loads = Array.from({ length: 21 }, (_, step) => step / 20)
  return Math.max(
    ...loads.map((load) => {
      poseAt(batter, -10_000 + load * 1000, load)
      return batInHead(batter) * PLAYER_SCALE
    }),
  )
}

/** The deepest the bat reaches into the head through a swing at `point`, its finish, and its return, in meters. */
function deepestInSwing(batter: Batter, point: Vec3 | null) {
  startSwing(batter, 0, 1, point)
  const frames = Array.from(
    { length: Math.floor((SWING_MS + FINISH_HOLD_MS + RETURN_MS) / 6) + 1 },
    (_, step) => step * 6,
  )
  return Math.max(
    ...frames.map((nowMs) => {
      poseAt(batter, nowMs, 1)
      return batInHead(batter) * PLAYER_SCALE
    }),
  )
}

/** The mirrored parts of two batters at `nowMs`: sweet spot, head, mittens, feet (field meters). */
function mirrorGaps(right: Batter, left: Batter, nowMs: number) {
  poseAt(right, nowMs, 1)
  poseAt(left, nowMs, 1)
  const parts = (batter: Batter) => [
    worldSweetSpot(batter),
    batter.rig.head.getWorldPosition(new Vector3()),
    ...batter.mittens.map((mitten) => mitten.getWorldPosition(new Vector3())),
    ...batter.rig.feet.map((foot) => foot.getWorldPosition(new Vector3())),
  ]
  const leftParts = parts(left)
  return parts(right).map((part, index) => leftParts[index].distanceTo(new Vector3(-part.x, part.y, part.z)))
}

describe('batter', () => {
  it('meets the ball CONTACT_DELAY_MS after a swing starts, from any point of the windup and at any reach', () => {
    const batters = {
      right: createBatter(DEFAULT_PLAYER_PROFILE, 'right'),
      left: createBatter(DEFAULT_PLAYER_PROFILE, 'left'),
    }
    const points = meetPoints.filter((_, index) => index % 5 === 0)
    const cases = sides.flatMap((side) => [0, 0.5, 1].flatMap((load) => points.map((point) => ({ side, load, point }))))
    for (const { side, load, point } of cases) {
      const batter = batters[side]
      startSwing(batter, 2000, load, point)
      poseAt(batter, 2000 + CONTACT_DELAY_MS, load)
      const ball = new Vector3(point.x, point.y, point.z)
      expect(worldSweetSpot(batter).distanceTo(ball)).toBeLessThan(0.002)
      poseAt(batter, 2000 + CONTACT_DELAY_MS - 15, load)
      expect(worldSweetSpot(batter).distanceTo(ball)).toBeGreaterThan(0.05)
    }
  })

  it('meets a PERFECT pitch at the swing’s contact key, where the bat is square', () => {
    const batter = createBatter(DEFAULT_PLAYER_PROFILE, 'right')
    const perfect = PITCH_TYPE_IDS.flatMap((type) => corners.map((corner) => meetPoint(type, corner, 0)))
    for (const point of perfect) {
      startSwing(batter, 0, 1, point)
      expect(Math.abs(batter.swing.contactAt - SWING_KEY_TIMES.contact)).toBeLessThan(0.001)
    }
  })

  it('swings a left-handed batter as the mirror image of a right-handed one', () => {
    const right = createBatter(DEFAULT_PLAYER_PROFILE, 'right')
    const left = createBatter(DEFAULT_PLAYER_PROFILE, 'left')
    const point = meetPoint('curve', corners[1], 0.05)
    startSwing(right, 0, 1, point)
    startSwing(left, 0, 1, { ...point, x: -point.x })
    const gaps = [-300, 20, CONTACT_DELAY_MS, 150, 700, 1100].flatMap((nowMs) => mirrorGaps(right, left, nowMs))
    expect(Math.max(...gaps)).toBeLessThan(1e-6)
  })

  it('keeps the bat out of the head, hair, and hat through the windup, the swing, and the return', () => {
    const looks: Partial<PlayerProfile>[] = [
      { hat: 'cap', hair: 'crop' },
      { hat: 'sunhat', hair: 'bob' },
      { hat: 'none', hair: 'curls', ears: 'pointed' },
    ]
    for (const look of looks) {
      const batter = createBatter({ ...DEFAULT_PLAYER_PROFILE, ...look }, 'right')
      const swings = [null, ...meetPoints].map((point) => deepestInSwing(batter, point))
      expect(Math.max(deepestInWindup(batter), ...swings)).toBeLessThan(0.005)
    }
  })
})
