import { Vector3 } from 'three'
import { describe, expect, it } from 'vitest'
import type { Vec3 } from '../../../data/models'
import {
  type AppearanceField,
  DEFAULT_PLAYER_PROFILE,
  type PlayerProfile,
  PROFILE_CHOICES,
} from '../../../data/playerProfile'
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
import { ARM_BONES, ARM_RADII, BALLPLAYER_BODY, FOREARM_RADIUS, shoulderPoint } from './ballplayerRig'
import { BAT, batPenetration, batRadiusAt } from './bat'
import { type Batter, batterPoseAt, createBatter, NO_SWING, poseBatter, startSwing } from './batter'
import { type BodyVolume, bodyVolumes, deepestPenetration, segmentDistance } from './bodyVolumes'
import { FOREARM_FREE_SPAN, MITTEN } from './mittenHands'
import {
  CONTACT_DELAY_MS,
  FINISH_HOLD_MS,
  RETURN_KEY_IDS,
  RETURN_KEY_MS,
  RETURN_MS,
  SWING_KEY_TIMES,
  SWING_MS,
  type SwingPose,
  WAGGLE_FADE_MS,
} from './swingMotion'

const sides: BattingSide[] = ['right', 'left']
/** A swing is back in its stance this long after it starts (ms). */
const RETURNED_MS = SWING_MS + FINISH_HOLD_MS + RETURN_MS
/** How deep anything may sink into anything (m): about a seam's width, invisible at the batting camera's distance. */
const TOLERANCE = 0.005

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

/** Option `index` of `field`, counting round its choices. */
function optionAt<Field extends AppearanceField>(field: Field, index: number) {
  const { options } = PROFILE_CHOICES[field]
  return options[index % options.length] as PlayerProfile[Field]
}

/**
 * Every hat with every hair (they fill the same place round the head), and every other option the town character
 * creator offers spread over them, so each one is worn at least once.
 */
const looks: Partial<PlayerProfile>[] = PROFILE_CHOICES.hat.options.flatMap((hat, hatIndex) =>
  PROFILE_CHOICES.hair.options.map((hair, hairIndex) => {
    const index = hatIndex * PROFILE_CHOICES.hair.options.length + hairIndex
    const spread = ['ears', 'nose', 'mustache', 'top', 'bottom', 'shoes'] as const
    return { hat, hair, ...Object.fromEntries(spread.map((field) => [field, optionAt(field, index + hatIndex)])) }
  }),
)

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

const along = new Vector3()

/** Mitten `index`'s capsule, as last posed: its two ends and its middle (rig frame). */
function mittenPoints(batter: Batter, index: number) {
  const mitten = batter.mittens[index]
  return [-1, 0, 1].map((end) =>
    new Vector3(0, 0, MITTEN.center + end * (MITTEN.long - MITTEN.wide))
      .applyQuaternion(mitten.quaternion)
      .add(mitten.position),
  )
}

/** Whether `volume` comes anywhere near the bat as last posed: most of the body is far from most of the bat. */
function nearBat(batter: Batter, volume: BodyVolume) {
  const fromKnob = along.copy(volume.center).sub(batter.knob)
  const height = Math.min(BAT.length, Math.max(0, fromKnob.dot(batter.axis)))
  const gap = fromKnob.addScaledVector(batter.axis, -height).length()
  return gap < volume.radii.length() + 0.1
}

/** How deep (rig units) the bat as last posed reaches into `volumes`, checked every 2 cm along it. */
function batInBody(batter: Batter, volumes: BodyVolume[]) {
  const near = volumes.filter((volume) => nearBat(batter, volume))
  const depths = Array.from({ length: 51 }, (_, step) => {
    const height = (BAT.length * step) / 50
    const center = along.copy(batter.knob).addScaledVector(batter.axis, height)
    return deepestPenetration(near, center, batRadiusAt(height))
  })
  return Math.max(...depths)
}

/** How deep (rig units) arm `index` reaches into `volumes`: its elbow, its forearm, and its mitten. */
function armInBody(batter: Batter, index: number, volumes: BodyVolume[]) {
  const elbow = batter.rig.elbows[index]
  const wrist = batter.rig.wrists[index]
  const forearm = [0.25, 0.5, 0.75, 1].map((share) =>
    deepestPenetration(volumes, along.copy(elbow).lerp(wrist, share), FOREARM_RADIUS),
  )
  const mitten = mittenPoints(batter, index).map((center) => deepestPenetration(volumes, center, MITTEN.wide))
  return Math.max(deepestPenetration(volumes, elbow, ARM_RADII.elbow), ...forearm, ...mitten)
}

/** How deep (rig units) the bat reaches into arm `index`: its shoulder, its upper arm, its forearm short of the mitten. */
function batInArm(batter: Batter, index: number) {
  const { knob, axis } = batter
  const elbow = batter.rig.elbows[index]
  const shoulder = shoulderPoint(batter.rig, index, new Vector3())
  const upperArm = [0.25, 0.5, 0.75, 1].map((share) =>
    batPenetration(knob, axis, along.copy(shoulder).lerp(elbow, share), ARM_RADII.upper),
  )
  const forearm = FOREARM_FREE_SPAN.map((share) =>
    batPenetration(knob, axis, along.copy(elbow).lerp(batter.rig.wrists[index], share), FOREARM_RADIUS),
  )
  return Math.max(batPenetration(knob, axis, shoulder, ARM_RADII.shoulder), ...upperArm, ...forearm)
}

/**
 * How deep (m) the batter as last posed sinks into itself anywhere: the bat into the head (with its hair and hat), the
 * torso, the hips, the legs, or an arm; an elbow, a forearm, or a mitten into the body; one forearm into the other.
 * Known limits the elbow's swivel alone cannot clear, left out: the upper arms cross under the chin, into the head by
 * up to about 3 cm from contact into the follow-through on a high pitch met early and into a bob's side hair by up to
 * 4 cm on an outside one (under 7 mm through the held finish), and the top forearm runs over the bottom mitten, by up
 * to about 3 cm, as the bat rolls over and on the way back, where the body hides both hands from the batting camera.
 */
function deepestInItself(batter: Batter) {
  const volumes = bodyVolumes(batter.rig)
  const { elbows, wrists } = batter.rig
  const forearms = 2 * FOREARM_RADIUS - segmentDistance(elbows[0], wrists[0], elbows[1], wrists[1])
  const depths = [batInBody(batter, volumes), forearms, ...[0, 1].map((index) => armInBody(batter, index, volumes))]
  return Math.max(...depths, ...[0, 1].map((index) => batInArm(batter, index))) * PLAYER_SCALE
}

/**
 * Game ms from a swing's start to check it at: every half ms to its contact, while the bat moves fastest, then every
 * ms while its aim fades out and the bat rolls over; with `full`, on for 200 ms, then every 5 ms through the finish,
 * the return, and the waggle fading back in.
 */
function swingFrames(full: boolean) {
  const toContact = Array.from({ length: CONTACT_DELAY_MS * 2 }, (_, step) => step / 2)
  const onward = Array.from({ length: full ? 200 : 100 }, (_, step) => CONTACT_DELAY_MS + step)
  const rest = Array.from(
    { length: (RETURNED_MS + WAGGLE_FADE_MS - CONTACT_DELAY_MS - 200) / 5 + 1 },
    (_, step) => CONTACT_DELAY_MS + 200 + step * 5,
  )
  return [...toContact, ...onward, ...(full ? rest : [])]
}

/** The deepest (m) a swing from `load` at `point` sinks the batter into itself, and where. */
function deepestInSwing(batter: Batter, load: number, point: Vec3 | null, full: boolean) {
  startSwing(batter, 0, load, point)
  const depths = swingFrames(full).map((nowMs) => {
    poseAt(batter, nowMs, nowMs < RETURNED_MS ? load : 0, true)
    return { depth: deepestInItself(batter), at: `${point ? 'a hit' : 'a miss'} from load ${load} at ${nowMs} ms` }
  })
  return depths.reduce((deepest, depth) => (depth.depth > deepest.depth ? depth : deepest))
}

/** The deepest (m) the batter sinks into itself through its windup, from the stance to the front foot down. */
function deepestInWindup(batter: Batter) {
  batter.swing = NO_SWING
  const depths = Array.from({ length: 21 }, (_, step) => {
    poseAt(batter, step * 100, step / 20, true)
    return { depth: deepestInItself(batter), at: `the windup at load ${step / 20}` }
  })
  return depths.reduce((deepest, depth) => (depth.depth > deepest.depth ? depth : deepest))
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
  startSwing(batter, 0, 1, point)
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
  'backSwivel',
  'frontSwivel',
] as const

/** The most any joint angle of `pose` (degrees) differs from `last`. */
function angleChange(pose: SwingPose, last: SwingPose) {
  return Math.max(...JOINT_ANGLES.map((channel) => Math.abs(pose[channel] - last[channel])))
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

  it('swings a left-handed batter as the mirror image of a right-handed one, through its return', () => {
    const right = createBatter(DEFAULT_PLAYER_PROFILE, 'right')
    const left = createBatter(DEFAULT_PLAYER_PROFILE, 'left')
    const point = meetPoint('curve', corners[1], 0.05)
    startSwing(right, 0, 1, point)
    startSwing(left, 0, 1, { ...point, x: -point.x })
    const times = [-300, 20, CONTACT_DELAY_MS, 150, 700, 1100, 1500, 1900, RETURNED_MS + 100]
    const gaps = times.flatMap((nowMs) => mirrorGaps(right, left, nowMs))
    expect(Math.max(...gaps)).toBeLessThan(1e-6)
  })

  // Each look meets one pitch type's balls in turn, the first look all of them, so every type meets every hair and hat.
  const cases = looks.map((look, index) => ({
    look,
    types: index === 0 ? PITCH_TYPE_IDS : [PITCH_TYPE_IDS[index % 3]],
  }))

  describe.each(sides)('batting %s-handed', (side) => {
    it.each(cases)(
      'keeps its bat, arms, and mittens out of its body and each other, wearing $look',
      ({ look, types }) => {
        const batter = createBatter({ ...DEFAULT_PLAYER_PROFILE, ...look }, side)
        const swings = [
          deepestInWindup(batter),
          deepestInSwing(batter, 1, null, true),
          ...[0, 0.5].map((load) => deepestInSwing(batter, load, null, false)),
          ...meetPointsOf(types).map((point) => deepestInSwing(batter, 1, point, false)),
        ]
        const deepest = swings.reduce((worst, swing) => (swing.depth > worst.depth ? swing : worst))
        expect(deepest.depth, deepest.at).toBeLessThan(TOLERANCE)
      },
    )
  })

  it('swings, holds its finish, and comes back to its stance smoothly, without a pop anywhere', () => {
    const batter = createBatter(DEFAULT_PLAYER_PROFILE, 'right')
    const outside = [meetPoint('changeup', corners[1], 0), meetPoint('fastball', corners[3], 0)]
    for (const point of [null, meetPoint('fastball', corners[0], 0), ...outside]) {
      startSwing(batter, 0, 1, point)
      const frames = Array.from({ length: RETURNED_MS + WAGGLE_FADE_MS }, (_, ms) => ms + 1)
      const poses = frames.map((nowMs) => ({ nowMs, pose: poseAt(batter, nowMs, nowMs < RETURNED_MS ? 1 : 0, true) }))
      const velocities = frames.map((nowMs) => ({ nowMs, velocities: velocitiesAt(batter, nowMs, 1) }))
      const changes = velocities.slice(1).map(({ nowMs, velocities: now }, index) => ({
        nowMs,
        speed: Math.max(...now.map((velocity, part) => velocity.distanceTo(velocities[index].velocities[part]))),
        angle: angleChange(poses[index + 1].pose, poses[index].pose),
      }))
      const swinging = changes.filter(({ nowMs }) => nowMs < SWING_MS)
      const after = changes.filter(({ nowMs }) => nowMs >= SWING_MS)
      expect(Math.max(...swinging.map(({ angle }) => angle))).toBeLessThan(10)
      expect(Math.max(...after.map(({ speed }) => speed))).toBeLessThan(0.3)
      expect(Math.max(...after.map(({ angle }) => angle))).toBeLessThan(0.5)
      // The way back is calm: the bat's tip and the mittens never rush, as the swing wound back would.
      const returning = velocities.filter(({ nowMs }) => nowMs >= SWING_MS).map((frame) => frame.velocities)
      expect(Math.max(...returning.map(([tip]) => tip.length()))).toBeLessThan(6)
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
  })

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

  it('never stretches an arm or slides its planted front foot through the held finish and the return', () => {
    const batter = createBatter(DEFAULT_PLAYER_PROFILE, 'right')
    startSwing(batter, 0, 1, null)
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

  it('is back in its stance before the next pitch can start its load, even after the shortest result', () => {
    const batter = createBatter(DEFAULT_PLAYER_PROFILE, 'right')
    const { ready, windup } = DERBY_PHASE_MS
    const nextLoadMs =
      CONTACT_DELAY_MS + Math.min(...Object.values(RESULT_HOLD_MS)) + ready + windup * BATTER_LOAD_START
    startSwing(batter, 0, 1, null)
    poseAt(batter, nextLoadMs, 0, true)
    const swung = trackedPoints(batter)
    batter.swing = NO_SWING
    poseAt(batter, nextLoadMs, 0, true)
    const standing = trackedPoints(batter)
    expect(Math.max(...swung.map((point, index) => point.distanceTo(standing[index])))).toBeLessThan(1e-9)
  })
})
