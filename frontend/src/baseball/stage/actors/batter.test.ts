import { Vector3 } from 'three'
import { describe, expect, it } from 'vitest'
import type { Vec3 } from '../../../data/models'
import { DEFAULT_PLAYER_PROFILE } from '../../../data/playerProfile'
import { DERBY_PHASE_MS, RESULT_HOLD_MS } from '../../game/derby'
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
import { BATTER_LOAD_START } from '../ballplayerCast'
import { PLAYER_SCALE } from '../stageLayout'
import { ARM_BONES, BALLPLAYER_BODY, hipOffset, shoulderPoint } from './ballplayerRig'
import { BAT } from './bat'
import {
  type Batter,
  batterPoseAt,
  beginSwing,
  checkSwing,
  createBatter,
  judgeSwing,
  NO_SWING,
  poseBatter,
} from './batter'
import { armStretch, batterOverlaps, OVERLAP_PAIRS } from '../../../testing/batterOverlap'
import {
  BEGUN_SWING,
  begunSwingState,
  CONTACT_DELAY_MS,
  FINISH_HOLD_MS,
  FOLLOW_MS,
  lastStretchMs,
  RETURN_KEY_IDS,
  RETURN_KEY_MS,
  RETURN_MS,
  SWING_KEY_IDS,
  SWING_KEY_TIMES,
  SWING_KEYS,
  SWING_MS,
  type SwingPose,
  WAGGLE_FADE_MS,
} from './swingMotion'

const sides: BattingSide[] = ['right', 'left']
/** A swing is back in its stance this long after it starts (ms). */
const RETURNED_MS = SWING_MS + FINISH_HOLD_MS + RETURN_MS
/** How deep anything may sink into anything (m): a millimeter, the overlap measure's own tolerance. */
const TOLERANCE = 0.001
/** How much longer than its bone an upper arm may be drawn: soft IK's own at an arm's full reach (twoBoneIk.ts). */
const STRETCH = 0.03

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

/** Pitches of `types` at every corner of the zone, met PERFECT and as early and as late as the reach allows. */
function meetPointsOf(types: readonly PitchTypeId[]) {
  return types.flatMap((type) => corners.flatMap((corner) => timings.map((timing) => meetPoint(type, corner, timing))))
}

const meetPoints = meetPointsOf(PITCH_TYPE_IDS)

/**
 * Swings at `point` (the contact point when null) a swing the camera saw no start of, taken at `startMs` (game ms) from
 * the windup at `load`: its bat meets the ball CONTACT_DELAY_MS later.
 */
function swingFromWindup(batter: Batter, startMs: number, load: number, point: Vec3 | null) {
  batter.swing = NO_SWING
  judgeSwing(batter, startMs, startMs, startMs + CONTACT_DELAY_MS, point, load)
}

function worldSweetSpot(batter: Batter) {
  batter.rig.root.updateMatrixWorld(true)
  return batter.bat.localToWorld(new Vector3(0, BAT.sweetSpot, 0))
}

function poseAt(batter: Batter, nowMs: number, load: number, waggle = false) {
  const pose = batterPoseAt(batter, nowMs, load, waggle)
  poseBatter(batter, pose)
  batter.rig.root.updateMatrixWorld(true)
  return pose
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

/** Points that show a pop: the bat's tip and knob, both mittens, both elbows, the head, the chest (field meters). */
function trackedPoints(batter: Batter) {
  batter.rig.root.updateMatrixWorld(true)
  const tip = batter.bat.localToWorld(new Vector3(0, BAT.length, 0))
  const knob = batter.bat.localToWorld(new Vector3())
  const mittens = batter.mittens.map((mitten) => mitten.getWorldPosition(new Vector3()))
  const elbows = batter.rig.elbows.map((elbow) => batter.rig.root.localToWorld(elbow.clone()))
  const head = batter.rig.head.getWorldPosition(new Vector3())
  const chest = batter.rig.body.localToWorld(new Vector3(0, BALLPLAYER_BODY.torso.centerY, 0))
  return [tip, knob, ...mittens, ...elbows, head, chest]
}

/** Where the bat, the hands, the elbows, and the head are every ms of a swing at `point`, from its start to its finish. */
function swingPath(batter: Batter, point: Vec3 | null) {
  swingFromWindup(batter, 0, 1, point)
  return Array.from({ length: SWING_MS + 1 }, (_, nowMs) => {
    poseAt(batter, nowMs, 1)
    return trackedPoints(batter)
  })
}

/** Each tracked point's velocity (m/s) over each ms of `path`. */
function pathVelocities(path: Vector3[][]) {
  return path
    .slice(1)
    .map((points, ms) => points.map((point, part) => point.clone().sub(path[ms][part]).multiplyScalar(1000)))
}

/** How deep (m) the batter as last posed sinks into itself, its deepest pair (batterOverlap.ts). */
function deepestInItself(batter: Batter) {
  const overlaps = batterOverlaps(batter)
  return Math.max(...OVERLAP_PAIRS.map((pair) => overlaps[pair]))
}

/**
 * The batter each ms from `fromMs` to `toMs` (game ms) at load 1: its tracked points, its bat's azimuth, and every
 * fifth ms how deep (m) it sinks into itself and how far an arm is drawn past its bone (batterOverlap.*.test.ts check
 * these swings closer).
 */
function drawnPath(batter: Batter, fromMs: number, toMs: number) {
  return Array.from({ length: toMs - fromMs + 1 }, (_, ms) => {
    const pose = poseAt(batter, fromMs + ms, 1)
    const measured = ms % 5 === 0
    const depth = measured ? deepestInItself(batter) : 0
    const stretch = measured ? armStretch(batter) : 0
    return { points: trackedPoints(batter), azimuth: pose.batAzimuth, depth, stretch }
  })
}

/**
 * Along a path a ms apart: the most any tracked point but the head changes velocity (m/s) from one ms to the next, the
 * head's most, and the head's top speed (m/s), the bounds a swing keeps to show no pop and a steady head.
 */
function popsAlong(path: { points: Vector3[] }[]) {
  const head = 6
  const velocities = pathVelocities(path.map(({ points }) => points))
  const changes = velocities
    .slice(1)
    .map((now, ms) => now.map((velocity, part) => velocity.distanceTo(velocities[ms][part])))
  return {
    body: Math.max(...changes.flatMap((change) => change.slice(0, head))),
    head: Math.max(...changes.map((change) => change[head])),
    headSpeed: Math.max(...velocities.map((velocity) => velocity[head].length())),
  }
}

/** How far (m) the sweet spot moves in the ms before `atMs` (game ms) at load 1: as it meets a ball then, how fast. */
function lastMsTravel(batter: Batter, atMs: number) {
  poseAt(batter, atMs - 1, 1)
  const before = worldSweetSpot(batter)
  poseAt(batter, atMs, 1)
  return worldSweetSpot(batter).distanceTo(before)
}

/** The tracked points' velocities (m/s) over `stepMs` from `nowMs`. */
function velocitiesAt(batter: Batter, nowMs: number, stepMs: number) {
  poseAt(batter, nowMs, nowMs < RETURNED_MS ? 1 : 0, true)
  const before = trackedPoints(batter)
  poseAt(batter, nowMs + stepMs, nowMs + stepMs < RETURNED_MS ? 1 : 0, true)
  return trackedPoints(batter).map((point, index) => point.sub(before[index]).multiplyScalar(1000 / stepMs))
}

/** The most any tracked point's velocity changes (m/s) across `atMs`, measured `stepMs` either side. */
function velocityJump(batter: Batter, atMs: number, stepMs: number) {
  const before = velocitiesAt(batter, atMs - stepMs, stepMs)
  const after = velocitiesAt(batter, atMs, stepMs)
  return Math.max(...after.map((velocity, index) => velocity.distanceTo(before[index])))
}

const JOINT_ANGLES = [
  'pelvisYaw',
  'chestYaw',
  'chestTilt',
  'chestSide',
  'chestRoll',
  'frontKnee',
  'backKnee',
  'batAzimuth',
  'batElevation',
  'gripAngle',
  'headYaw',
  'headPitch',
  'headRoll',
  'backSwivel',
  'frontSwivel',
] as const
const HEAD_ANGLES = ['headYaw', 'headPitch', 'headRoll'] as const

/** The most any of `channels` (joint angles, degrees) of `pose` differs from `last`. */
function angleChange(pose: SwingPose, last: SwingPose, channels: readonly (keyof SwingPose)[] = JOINT_ANGLES) {
  return Math.max(...channels.map((channel) => Math.abs(pose[channel] - last[channel])))
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
      swingFromWindup(batter, 2000, load, point)
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
      swingFromWindup(batter, 0, 1, point)
      expect(Math.abs(batter.swing.contactAt - SWING_KEY_TIMES.contact)).toBeLessThan(0.001)
    }
  })

  it('swings a left-handed batter as the mirror image of a right-handed one, through its return', () => {
    const right = createBatter(DEFAULT_PLAYER_PROFILE, 'right')
    const left = createBatter(DEFAULT_PLAYER_PROFILE, 'left')
    const point = meetPoint('curve', corners[1], 0.05)
    swingFromWindup(right, 0, 1, point)
    swingFromWindup(left, 0, 1, { ...point, x: -point.x })
    const times = [-300, 20, CONTACT_DELAY_MS, 150, 700, 1100, 1500, 1900, RETURNED_MS + 100]
    const gaps = times.flatMap((nowMs) => mirrorGaps(right, left, nowMs))
    expect(Math.max(...gaps)).toBeLessThan(1e-6)
  })

  // Every look, both sides, and every pitch the batter can meet are checked for overlaps in batterOverlap.*.test.ts.

  // The plain bob also plays it: its side hair is the nearest the arms come to the head, which turns to clear them.
  it.each([{ hair: 'crop' }, { hair: 'bob' }] as const)(
    'swings, holds its finish, and comes back to its stance smoothly, without a pop anywhere, wearing $hair hair',
    (look) => {
      const batter = createBatter({ ...DEFAULT_PLAYER_PROFILE, ...look }, 'right')
      const outside = [meetPoint('changeup', corners[1], 0), meetPoint('fastball', corners[3], 0)]
      for (const point of [null, meetPoint('fastball', corners[0], 0), ...outside]) {
        swingFromWindup(batter, 0, 1, point)
        const frames = Array.from({ length: RETURNED_MS + WAGGLE_FADE_MS }, (_, ms) => ms + 1)
        const poses = frames.map((nowMs) => ({ nowMs, pose: poseAt(batter, nowMs, nowMs < RETURNED_MS ? 1 : 0, true) }))
        const velocities = frames.map((nowMs) => ({ nowMs, velocities: velocitiesAt(batter, nowMs, 1) }))
        const changes = velocities.slice(1).map(({ nowMs, velocities: now }, index) => ({
          nowMs,
          speed: Math.max(...now.map((velocity, part) => velocity.distanceTo(velocities[index].velocities[part]))),
          angle: angleChange(poses[index + 1].pose, poses[index].pose),
          head: angleChange(poses[index + 1].pose, poses[index].pose, HEAD_ANGLES),
        }))
        const swinging = changes.filter(({ nowMs }) => nowMs < SWING_MS)
        const after = changes.filter(({ nowMs }) => nowMs >= SWING_MS)
        expect(Math.max(...swinging.map(({ angle }) => angle))).toBeLessThan(10)
        expect(Math.max(...after.map(({ speed }) => speed))).toBeLessThan(0.3)
        expect(Math.max(...after.map(({ angle }) => angle))).toBeLessThan(0.5)
        // The head keeps its eyes on the ball through the swing, and on the way back turns about 25 degrees over its
        // keys, tilting calmly round the shoulder and the hands it clears instead of wobbling.
        expect(Math.max(...swinging.map(({ head }) => head))).toBeLessThan(4)
        expect(Math.max(...after.map(({ head }) => head))).toBeLessThan(0.15)
        // The way back is calm: the bat's tip and the mittens never rush, as the swing wound back would. The tip runs
        // 0.87 rig units past the hands, the bottom mitten holding the bat at its knob.
        const returning = velocities.filter(({ nowMs }) => nowMs >= SWING_MS).map((frame) => frame.velocities)
        expect(Math.max(...returning.map(([tip]) => tip.length()))).toBeLessThan(6.5)
        const mittenSpeeds = returning.flatMap(([, , back, front]) => [back.length(), front.length()])
        expect(Math.max(...mittenSpeeds)).toBeLessThan(4)
        const seams = [
          SWING_MS,
          ...RETURN_KEY_IDS.map((id) => SWING_MS + RETURN_KEY_MS[id]),
          RETURNED_MS + WAGGLE_FADE_MS,
        ]
        expect(velocityJump(batter, CONTACT_DELAY_MS, 0.005)).toBeLessThan(0.5)
        expect(Math.max(...seams.map((atMs) => velocityJump(batter, atMs, 0.01)))).toBeLessThan(0.01)
      }
    },
  )

  // A swing plays the research's 175 ms from the foot strike in CONTACT_DELAY_MS, under three frames at 60 fps, so one
  // that meets its ball early in the swing turns its bat onto it in under 10 ms: no point's velocity ever jumps, but
  // there it changes fastest, about 34 m/s within a ms (the plan's 15 held for the zone's center only).
  it.each(sides)('swings %s-handed at every pitch it can meet without a pop, its head steady', (side) => {
    const batter = createBatter(DEFAULT_PLAYER_PROFILE, side)
    const head = 6
    for (const point of [null, ...meetPoints]) {
      const velocities = pathVelocities(swingPath(batter, point))
      const changes = velocities
        .slice(1)
        .map((now, ms) => now.map((velocity, part) => velocity.distanceTo(velocities[ms][part])))
      expect(Math.max(...changes.flatMap((change) => change.slice(0, head)))).toBeLessThan(36)
      expect(Math.max(...velocities.map((velocity) => velocity[head].length()))).toBeLessThan(11)
      expect(Math.max(...changes.map((change) => change[head]))).toBeLessThan(5)
    }
  })

  it('swings a swing begun early on to its ball without a jump, a step back, a pop, or sinking into itself', () => {
    const batter = createBatter(DEFAULT_PLAYER_PROFILE, 'right')
    const readyMs = 90
    const { easeMs } = BEGUN_SWING
    // Through and well after the moment the camera expected the grip to cross, the bat is still on its way: it does not
    // stop to wait for the swing to be judged.
    beginSwing(batter, 0, readyMs, 1, meetPoint('fastball', corners[1], 0))
    const waiting = pathVelocities(drawnPath(batter, readyMs - 10, readyMs + 80).map(({ points }) => points))
    expect(Math.min(...waiting.map(([tip]) => tip.length()))).toBeGreaterThan(0.5)
    // Begun at 0 toward where the pitch meets a PERFECT swing, then judged on its way, easing into the slot, and going
    // back after it waited in vain: in time for its last stretch, or so late that the stage stepped its clock back to
    // give it one (`afterMs` below none). It meets the ball PERFECT, at the back of the reach as early in the swing as
    // any, or out in front.
    const judgings = [
      { takenMs: 30, afterMs: 20 },
      { takenMs: readyMs + 40, afterMs: 0 },
      { takenMs: readyMs + easeMs + 70, afterMs: 0 },
      { takenMs: 60, afterMs: -40 },
      { takenMs: readyMs + 70, afterMs: -70 },
    ]
    const pitches = [
      { type: 'fastball', corner: corners[1], timing: 0 },
      { type: 'curve', corner: corners[2], timing: 0.3 },
      { type: 'changeup', corner: corners[3], timing: -0.2 },
    ] as const
    const cases = pitches.flatMap(({ type, corner, timing }) =>
      judgings.map((judging) => ({
        aim: meetPoint(type, corner, 0),
        point: meetPoint(type, corner, timing),
        ...judging,
      })),
    )
    for (const { aim, point, takenMs, afterMs } of cases) {
      batter.swing = NO_SWING
      beginSwing(batter, 0, readyMs, 1, aim)
      // As the stage times it: from about where the bat is drawn when the stage takes it (stageRun.ts lastStretchFor).
      const { seconds, rate } = begunSwingState(0, readyMs, takenMs)
      const stretchMs = lastStretchMs(seconds, rate)
      const throughMs = takenMs + afterMs
      const before = drawnPath(batter, 0, takenMs)
      judgeSwing(batter, takenMs, throughMs, throughMs + stretchMs, point, 1)
      // On the stage's clock, the swing goes on from where it was when the stage took it, and from there only on.
      const onward = drawnPath(batter, Math.min(takenMs, throughMs) + 1, throughMs + FOLLOW_MS)
      const path = [...before, ...onward]
      const turns = onward.map(({ azimuth }, ms) => azimuth - path[before.length + ms - 1].azimuth)
      expect(Math.min(...turns)).toBeGreaterThan(-1e-6)
      const pops = popsAlong(path)
      expect(pops.body).toBeLessThan(36)
      expect(pops.head).toBeLessThan(5)
      expect(pops.headSpeed).toBeLessThan(11)
      expect(Math.max(...path.map(({ depth }) => depth))).toBeLessThan(TOLERANCE)
      expect(Math.max(...path.map(({ stretch }) => stretch))).toBeLessThan(STRETCH)
      poseAt(batter, throughMs + stretchMs, 1)
      expect(worldSweetSpot(batter).distanceTo(new Vector3(point.x, point.y, point.z))).toBeLessThan(0.002)
      // It meets the ball about as fast as a swing the camera saw no start of: the swing seen first is no weaker.
      const cued = lastMsTravel(batter, throughMs + stretchMs)
      swingFromWindup(batter, 0, 1, point)
      expect(cued).toBeGreaterThan(0.7 * lastMsTravel(batter, CONTACT_DELAY_MS))
    }
  })

  it('checks a swing short of the plate and takes it back to the windup, or on to the ball, without a pop', () => {
    const batter = createBatter(DEFAULT_PLAYER_PROFILE, 'right')
    const readyMs = 90
    const { easeMs } = BEGUN_SWING
    const slotAzimuth = SWING_KEYS.batAzimuth[SWING_KEY_IDS.indexOf('slot')]
    const aim = meetPoint('fastball', corners[1], 0)
    // Checked on its way to the slot, easing into it, all but at rest there, and never: then it goes back by itself.
    for (const checkedMs of [70, readyMs + 60, readyMs + easeMs - 5, Infinity]) {
      batter.swing = NO_SWING
      beginSwing(batter, 0, readyMs, 1, aim)
      checkSwing(batter, checkedMs, 1)
      const backAtMs = batter.swing.check!.backMs
      const path = drawnPath(batter, 0, backAtMs + 20)
      expect(Math.max(...path.map(({ azimuth }) => azimuth))).toBeLessThan(slotAzimuth + 1e-6)
      const pops = popsAlong(path)
      expect(pops.body).toBeLessThan(36)
      expect(pops.head).toBeLessThan(5)
      expect(Math.max(...path.map(({ depth }) => depth))).toBeLessThan(TOLERANCE)
      expect(Math.max(...path.map(({ stretch }) => stretch))).toBeLessThan(STRETCH)
      // Back in the windup as if it had never swung.
      const checked = path.at(-1)!.points
      batter.swing = NO_SWING
      poseAt(batter, backAtMs + 20, 1)
      const standing = trackedPoints(batter)
      expect(Math.max(...checked.map((part, index) => part.distanceTo(standing[index])))).toBeLessThan(1e-9)
    }
    // A bat checked as it eases slowly into the slot is soon on its way back, rather than standing still a while first.
    beginSwing(batter, 0, readyMs, 1, aim)
    checkSwing(batter, readyMs + 60, 1)
    const [stopping, goingBack] = [readyMs + 90, readyMs + 180].map((nowMs) => drawnPath(batter, nowMs, nowMs)[0])
    expect(goingBack.points[0].distanceTo(stopping.points[0])).toBeGreaterThan(0.02)
    // A check that comes once the swing is on its way back by itself changes nothing.
    beginSwing(batter, 0, readyMs, 1, aim)
    const unchecked = drawnPath(batter, 0, 700)
    checkSwing(batter, readyMs + easeMs + 30, 1)
    expect(drawnPath(batter, 0, 700)).toEqual(unchecked)
    // Judged after all on its way back, for a contact still to come: it waits where it was, then swings through.
    const point = meetPoint('changeup', corners[0], 0)
    beginSwing(batter, 0, readyMs, 1, point)
    checkSwing(batter, 150, 1)
    const takenMs = Math.round((batter.swing.check!.backFromMs + batter.swing.check!.backMs) / 2)
    judgeSwing(batter, takenMs, takenMs + 80, takenMs + 80 + CONTACT_DELAY_MS, point, 1)
    const path = drawnPath(batter, 0, takenMs + CONTACT_DELAY_MS + 80)
    const pops = popsAlong(path)
    expect(pops.body).toBeLessThan(36)
    expect(pops.head).toBeLessThan(5)
    expect(worldSweetSpot(batter).distanceTo(new Vector3(point.x, point.y, point.z))).toBeLessThan(0.002)
  })

  it('never stretches an arm or slides its planted front foot through the held finish and the return', () => {
    const batter = createBatter(DEFAULT_PLAYER_PROFILE, 'right')
    swingFromWindup(batter, 0, 1, null)
    const frames = Array.from({ length: FINISH_HOLD_MS + RETURN_MS + 1 }, (_, ms) => {
      const pose = poseAt(batter, SWING_MS + ms, 0)
      const arms = [0, 1].map((index) => {
        const shoulder = shoulderPoint(batter.rig, index, new Vector3())
        return {
          reach: shoulder.distanceTo(batter.rig.wrists[index]),
          upper: shoulder.distanceTo(batter.rig.elbows[index]),
        }
      })
      return { lift: pose.frontFootLift, ankle: batter.rig.ankles[1].clone(), arms }
    })
    const arms = frames.flatMap((frame) => frame.arms)
    expect(Math.max(...arms.map(({ reach }) => reach))).toBeLessThan((ARM_BONES.upper + ARM_BONES.fore) * (1 + 1e-3))
    // Soft IK draws an arm close to its full reach a little long (twoBoneIk.ts), never visibly.
    expect(Math.max(...arms.map(({ upper }) => upper / ARM_BONES.upper))).toBeLessThan(1.02)
    const planted = frames.slice(
      0,
      frames.findIndex(({ lift }) => lift > 0),
    )
    const slides = planted.map(({ ankle }) => ankle.distanceTo(frames[0].ankle) * PLAYER_SCALE)
    expect(planted.length).toBeGreaterThan(FINISH_HOLD_MS)
    expect(Math.max(...slides)).toBeLessThan(0.01)
  })

  it('keeps both feet planted while its body reaches for a ball out in front, its legs reaching them', () => {
    const batter = createBatter(DEFAULT_PLAYER_PROFILE, 'right')
    const { thigh, shin } = BALLPLAYER_BODY
    for (const point of [meetPoint('fastball', corners[3], -0.2), meetPoint('curve', corners[1], -0.2), null]) {
      swingFromWindup(batter, 0, 1, point)
      const frames = Array.from({ length: SWING_MS + 1 }, (_, nowMs) => {
        poseAt(batter, nowMs, 1)
        const { rig } = batter
        const reached = [0, 1].map((index) => {
          const hip = hipOffset(rig.pelvisTurn, index, new Vector3()).add(rig.pelvis.position)
          const knee = new Vector3(0, -thigh, 0).applyQuaternion(rig.legs[index].quaternion).add(hip)
          const shinTurn = rig.legs[index].quaternion.clone().multiply(rig.knees[index].quaternion)
          return new Vector3(0, -shin, 0).applyQuaternion(shinTurn).add(knee).distanceTo(rig.ankles[index])
        })
        return { front: rig.ankles[1].clone(), reached: Math.max(...reached) }
      })
      const slides = frames.map(({ front }) => front.distanceTo(frames[0].front) * PLAYER_SCALE)
      expect(Math.max(...slides)).toBeLessThan(1e-6)
      expect(Math.max(...frames.map(({ reached }) => reached)) * PLAYER_SCALE).toBeLessThan(0.001)
    }
  })

  it('is back in its stance before the next pitch can start its load, even after the shortest result', () => {
    const batter = createBatter(DEFAULT_PLAYER_PROFILE, 'right')
    const { ready, windup } = DERBY_PHASE_MS
    const nextLoadMs =
      CONTACT_DELAY_MS + Math.min(...Object.values(RESULT_HOLD_MS)) + ready + windup * BATTER_LOAD_START
    swingFromWindup(batter, 0, 1, null)
    poseAt(batter, nextLoadMs, 0, true)
    const swung = trackedPoints(batter)
    batter.swing = NO_SWING
    poseAt(batter, nextLoadMs, 0, true)
    const standing = trackedPoints(batter)
    expect(Math.max(...swung.map((point, index) => point.distanceTo(standing[index])))).toBeLessThan(1e-9)
  })
})
