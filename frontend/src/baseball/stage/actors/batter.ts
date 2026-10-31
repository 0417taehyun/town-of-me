import type { Group, Mesh } from 'three'
import { MathUtils, Vector3 } from 'three'
import type { Vec3 } from '../../../data/models'
import type { PlayerProfile } from '../../../data/playerProfile'
import { lerp, smoothstep } from '../../../motionMath'
import { BASES, type BattingSide, CONTACT_DEPTH, STRIKE_ZONE } from '../../game/field'
import { batterSpot, PLAYER_SCALE } from '../stageLayout'
import {
  ANKLE_IN_FOOT,
  type BallplayerRig,
  createBallplayerRig,
  direction,
  disposeBallplayerRig,
  type LegStance,
  poseChest,
  poseLegs,
  SHOULDER,
  turnHead,
} from './ballplayerRig'
import { BAT, batRadiusAt, createBat } from './bat'
import { bodyVolumes, deepestPenetration } from './bodyVolumes'
import { monotoneTrack } from './keyframes'
import { fieldToRig, type HeadLook } from './headLook'
import { createMitten, MITTEN, placeMittens, searchSwivel } from './mittenHands'
import {
  blendSwingPoses,
  CONTACT_DELAY_MS,
  createSwingMotion,
  FINISH_HOLD_MS,
  RETURN_MS,
  sampleSwingPose,
  SWING_CONSTANTS,
  SWING_KEY_IDS,
  SWING_KEY_TIMES,
  SWING_MS,
  type SwingMotion,
  type SwingPose,
  swingSeconds,
  windupSeconds,
} from './swingMotion'

// The visitor's own town character at bat (ballplayerRig.ts) with mitten hands, posed from the swing's data
// (swingMotion.ts). The game drives the windup with a load from 0 to 1; a swing then plays the data compressed so the
// bat meets the ball CONTACT_DELAY_MS after it starts, aimed at where the ball is at that moment: a ball deeper along
// the pitch line is met earlier in the swing (hips less open, bat still lagging), one further out later, and the grip
// shifts by what is left. A left-handed batter is the mirror image. The rig reads the game core's contact point and
// never the other way round: the judge decides, the batter shows it.

export type Batter = {
  rig: BallplayerRig
  bat: Mesh
  mittens: [Group, Group]
  motion: SwingMotion
  /** The bat as last posed (rig frame): its knob, its direction from knob to barrel, the grip's middle, its sweet spot. */
  knob: Vector3
  axis: Vector3
  gripMiddle: Vector3
  sweetSpot: Vector3
  swing: BatterSwing
}

/**
 * The swing under way: when it started (game ms), the windup second it left from, the swing second its bat meets the
 * ball, the grip shift (rig frame) that puts the sweet spot on the ball then, and how far the head tips up (degrees) to
 * keep its eyes on that ball.
 */
export type BatterSwing = { startMs: number; from: number; contactAt: number; aimShift: Vector3; headLift: number }

/**
 * What the swing is aimed at before any pitch (field meters): the strike zone's center at the contact depth in front of
 * the plate's center, the depth where a PERFECT swing meets the ball with the bat square.
 */
export const CONTACT_POINT: Vec3 = { x: BASES.home.x, y: STRIKE_ZONE.center, z: BASES.home.z - CONTACT_DEPTH }
/** The grip's origin (body space): the back shoulder, the research's pivot for the hands. */
export const GRIP_ORIGIN = new Vector3(-SHOULDER.x, SHOULDER.y, SHOULDER.z)
/** Half-width (swing seconds) of the window in which a swing's own grip shift fades in and out round its contact. */
export const AIM_FADE_SECONDS = 0.06

const UP = new Vector3(0, 1, 0)
/** No swing under way: the batter stands in its windup. */
export const NO_SWING: BatterSwing = { startMs: -Infinity, from: 0, contactAt: 0, aimShift: new Vector3(), headLift: 0 }

export function mirrorOf(side: BattingSide) {
  return side === 'left' ? -1 : 1
}

/**
 * Stands the batter at the plate on `side`: the rig's root stands at the batter's spot facing the plate (+z), the
 * pitcher on its +x, scaled to a player and mirrored for a left-handed batter. Field points reach its frame through
 * the root (headLook.ts fieldToRig).
 */
export function placeBatter(batter: Batter, side: BattingSide) {
  const { root } = batter.rig
  const spot = batterSpot(side)
  const mirror = mirrorOf(side)
  root.position.set(spot.x, spot.y, spot.z)
  root.rotation.set(0, (mirror * Math.PI) / 2, 0)
  root.scale.set(mirror * PLAYER_SCALE, PLAYER_SCALE, PLAYER_SCALE)
}

/** The legs' part of a swing pose: the back foot pivots on its ball, the front one is placed by its ankle. */
export function legStanceOf(pose: SwingPose): LegStance {
  const frontYaw = MathUtils.degToRad(pose.frontFootYaw)
  const footAhead = -ANKLE_IN_FOOT.z
  return {
    pelvisX: pose.pelvisX,
    pelvisZ: pose.pelvisZ,
    pelvisYaw: pose.pelvisYaw,
    pelvisTilt: SWING_CONSTANTS.pelvisTilt,
    feet: [
      {
        x: pose.backFootX,
        z: SWING_CONSTANTS.backFootZ,
        lift: 0,
        yaw: pose.backFootYaw,
        heel: pose.backHeel,
        kneeAzimuth: pose.backKneeAzimuth,
        kneeFlexion: pose.backKnee,
      },
      {
        x: pose.frontFootX + footAhead * Math.sin(frontYaw),
        z: SWING_CONSTANTS.frontFootZ + footAhead * Math.cos(frontYaw),
        lift: pose.frontFootLift,
        yaw: pose.frontFootYaw,
        heel: pose.frontHeel,
        kneeAzimuth: pose.frontKneeAzimuth,
        kneeFlexion: pose.frontKnee,
      },
    ],
  }
}

const gripOffset = new Vector3()

/** Poses the legs, chest, head, and bat; the bat hangs off the grip, so the hands can follow it (poseBatter). */
export function poseBody(batter: Batter, pose: SwingPose) {
  const { rig, bat, axis, knob } = batter
  poseLegs(rig, legStanceOf(pose))
  const chest = { yaw: pose.chestYaw, tilt: pose.chestTilt, side: pose.chestSide, roll: pose.chestRoll }
  poseChest(rig, chest, pose.headYaw, pose.headPitch)
  direction(pose.batAzimuth, pose.batElevation, axis)
  batter.gripMiddle
    .copy(GRIP_ORIGIN)
    .applyMatrix4(rig.body.matrix)
    .add(gripOffset.set(pose.gripX, pose.gripY, pose.gripZ))
  knob.copy(batter.gripMiddle).addScaledVector(axis, -BAT.gripMiddle)
  batter.sweetSpot.copy(knob).addScaledVector(axis, BAT.sweetSpot)
  bat.position.copy(knob)
  bat.quaternion.setFromUnitVectors(UP, axis)
}

const bottomGrip = new Vector3()
const topGrip = new Vector3()
const backPole = new Vector3()
const frontPole = new Vector3()

/** The bottom (front) and top (back) mittens' places on the handle, around the grip's middle. */
export function gripPoints(batter: Batter) {
  const { gripMiddle, axis } = batter
  return {
    bottom: bottomGrip.copy(gripMiddle).addScaledVector(axis, -MITTEN.gap / 2),
    top: topGrip.copy(gripMiddle).addScaledVector(axis, MITTEN.gap / 2),
    axis,
  }
}

/** Each elbow's pole [back, front] for `pose`. */
export function elbowPoles(pose: SwingPose): [Vector3, Vector3] {
  return [
    direction(pose.backPoleAzimuth, pose.backPoleElevation, backPole),
    direction(pose.frontPoleAzimuth, pose.frontPoleElevation, frontPole),
  ]
}

export function poseBatter(batter: Batter, pose: SwingPose) {
  poseBody(batter, pose)
  placeMittens(batter.rig, batter.mittens, gripPoints(batter), elbowPoles(pose), [pose.backSwivel, pose.frontSwivel])
}

const aimTarget = new Vector3()

/**
 * Sets the swing's aim: the grip shift, faded in by the `aim` channel, that puts the contact key's sweet spot on the
 * contact point, so a PERFECT swing meets the ball there with the bat square.
 */
export function aimMotion(batter: Batter) {
  batter.motion.aimOffset = { x: 0, y: 0, z: 0 }
  poseBody(batter, sampleSwingPose(batter.motion, SWING_KEY_TIMES.contact))
  const shift = fieldToRig(batter.rig, CONTACT_POINT, aimTarget).sub(batter.sweetSpot)
  batter.motion.aimOffset = { x: shift.x, y: shift.y, z: shift.z }
}

/** Swing seconds the elbows are solved at: every key, every 20 ms from the stance, every 10 ms from the foot strike. */
export function swivelSolveTimes() {
  const { stance, footStrike, finish } = SWING_KEY_TIMES
  const every = (from: number, step: number) =>
    Array.from({ length: Math.ceil((finish - from) / step) }, (_, count) => from + count * step)
  const times = [...SWING_KEY_IDS.map((id) => SWING_KEY_TIMES[id]), ...every(stance, 0.02), ...every(footStrike, 0.01)]
  const rounded = new Set(times.map((time) => Math.round(time * 1000) / 1000))
  return [...rounded].sort((first, second) => first - second)
}

/** Both elbows' swivels [back, front] at swing second `time`, each searched near the last ones. */
export function solveSwivelsAt(batter: Batter, time: number, near: [number, number]): [number, number] {
  const pose = sampleSwingPose(batter.motion, time)
  poseBody(batter, pose)
  const volumes = bodyVolumes(batter.rig)
  const { bottom, top } = gripPoints(batter)
  const [back, front] = elbowPoles(pose)
  return [
    searchSwivel(batter.rig, 0, top, batter, back, near[0], volumes),
    searchSwivel(batter.rig, 1, bottom, batter, front, near[1], volumes),
  ]
}

/**
 * Solves the elbows' swivels through the swing once, so the forearms stay off the bat and out of the head and body:
 * each sample starts from the last, so the elbows move smoothly. Most of a new batter's cost: about 15-20 ms in a
 * desktop browser, nearly 40 ms the first time, spent while Ballplayers renders a new character or batting side.
 */
export function solveSwivels(batter: Batter) {
  batter.motion.swivels = null
  const times = swivelSolveTimes()
  const solved: [number, number][] = []
  times.forEach((time) => solved.push(solveSwivelsAt(batter, time, solved.at(-1) ?? [0, 0])))
  batter.motion.swivels = [
    monotoneTrack(
      times,
      solved.map(([back]) => back),
    ),
    monotoneTrack(
      times,
      solved.map(([, front]) => front),
    ),
  ]
}

/** The visitor's batter on `side`, aimed at the contact point and standing in its stance. */
export function createBatter(profile: PlayerProfile, side: BattingSide): Batter {
  const rig = createBallplayerRig(profile)
  const bat = createBat(rig)
  rig.root.add(bat)
  const batter: Batter = {
    rig,
    bat,
    mittens: [createMitten(rig, 0), createMitten(rig, 1)],
    motion: createSwingMotion(),
    knob: new Vector3(),
    axis: new Vector3(),
    gripMiddle: new Vector3(),
    sweetSpot: new Vector3(),
    swing: NO_SWING,
  }
  placeBatter(batter, side)
  aimMotion(batter)
  solveSwivels(batter)
  poseBatter(batter, sampleSwingPose(batter.motion, windupSeconds(0)))
  return batter
}

export function disposeBatter(batter: Batter) {
  disposeBallplayerRig(batter.rig)
}

/** The sweet spot's depth toward the pitcher (rig x) at swing second `time`, before any swing's own grip shift. */
export function sweetSpotDepth(batter: Batter, time: number) {
  poseBody(batter, sampleSwingPose(batter.motion, time))
  return batter.sweetSpot.x
}

/** Halves `range` (swing seconds) toward the moment the sweet spot reaches `depth`; it sweeps forward through contact. */
export function halveContactRange(batter: Batter, [early, late]: [number, number], depth: number): [number, number] {
  const middle = (early + late) / 2
  return sweetSpotDepth(batter, middle) < depth ? [middle, late] : [early, middle]
}

/** The swing second, between the slot and the extension, when the sweet spot reaches `depth` (rig x). */
export function contactMoment(batter: Batter, depth: number) {
  const { slot, extension } = SWING_KEY_TIMES
  if (sweetSpotDepth(batter, slot) >= depth) return slot
  if (sweetSpotDepth(batter, extension) <= depth) return extension
  let range: [number, number] = [slot, extension]
  for (let step = 0; step < 12; step++) range = halveContactRange(batter, range, depth)
  return (range[0] + range[1]) / 2
}

const headCenter = new Vector3()

/** Degrees below level that `point` is seen from the head as last posed (rig frame). */
export function lookDown(batter: Batter, point: Vector3) {
  headCenter.copy(batter.rig.head.position).applyMatrix4(batter.rig.body.matrix)
  const level = Math.hypot(point.x - headCenter.x, point.z - headCenter.z)
  return MathUtils.radToDeg(Math.atan2(headCenter.y - point.y, level))
}

/**
 * Starts a swing at `startMs` (game ms) from a windup at `load` whose bat meets `point` (field meters; the contact
 * point when null) CONTACT_DELAY_MS later. The start may be past: a swing reported after it was made catches up. The
 * head follows the grip's shift with its eyes, which also keeps a cap's brim off a bat meeting a high pitch.
 */
export function startSwing(batter: Batter, startMs: number, load: number, point: Vec3 | null) {
  const target = fieldToRig(batter.rig, point ?? CONTACT_POINT, aimTarget)
  const contactAt = contactMoment(batter, target.x)
  poseBody(batter, sampleSwingPose(batter.motion, contactAt))
  const headLift = lookDown(batter, batter.sweetSpot) - lookDown(batter, target)
  const aimShift = target.clone().sub(batter.sweetSpot)
  batter.swing = { startMs, from: windupSeconds(load), contactAt, aimShift, headLift }
}

/** The swing's pose at swing second `time`, with its own grip shift and head lift faded in round its contact. */
export function aimedSwingPose(batter: Batter, time: number) {
  const { contactAt, aimShift, headLift } = batter.swing
  const pose = sampleSwingPose(batter.motion, time)
  const weight = smoothstep(Math.max(0, 1 - Math.abs(time - contactAt) / AIM_FADE_SECONDS))
  pose.gripX += weight * aimShift.x
  pose.gripY += weight * aimShift.y
  pose.gripZ += weight * aimShift.z
  pose.headPitch -= weight * headLift
  return pose
}

/**
 * How much of the head's turn at `nowMs` (game ms) is the swing's own, 0..1, rather than its eyes following the ball:
 * all of it from contact through the held finish, where the swing keeps the head clear of the bat, fading in from the
 * swing's start and out over its return.
 */
export function swingHeadWeight(batter: Batter, nowMs: number) {
  const elapsed = nowMs - batter.swing.startMs
  const held = SWING_MS + FINISH_HOLD_MS
  if (elapsed < 0 || elapsed > held + RETURN_MS) return 0
  return smoothstep(Math.min(elapsed / CONTACT_DELAY_MS, 1, (held + RETURN_MS - elapsed) / RETURN_MS))
}

/**
 * The batter's pose at `nowMs` (game ms): the windup at `load` (0 stance, 0.5 toe lift, 1 front foot down) with the
 * stance's waggle fading as it loads, or the swing under way, its finish held, then eased back into the windup.
 */
export function batterPoseAt(batter: Batter, nowMs: number, load: number, waggle: boolean): SwingPose {
  const amount = waggle ? Math.max(0, 1 - load * 2) : 0
  const windup = sampleSwingPose(batter.motion, windupSeconds(load), { at: nowMs / 1000, amount })
  const { startMs, from, contactAt } = batter.swing
  const elapsed = nowMs - startMs
  if (elapsed < 0 || elapsed > SWING_MS + FINISH_HOLD_MS + RETURN_MS) return windup
  const swing = aimedSwingPose(batter, swingSeconds(from, contactAt, elapsed))
  if (elapsed <= SWING_MS + FINISH_HOLD_MS) return swing
  return blendSwingPoses(swing, windup, (elapsed - SWING_MS - FINISH_HOLD_MS) / RETURN_MS)
}

const alongBat = new Vector3()

/** How deep the bat as last posed reaches into the head with its hair and hat (rig units), checked along its length. */
export function batInHead(batter: Batter) {
  const head = bodyVolumes(batter.rig).filter((volume) => volume.part === 'head')
  const depths = Array.from({ length: 25 }, (_, step) => {
    const height = 0.04 * (step + 1)
    return deepestPenetration(
      head,
      alongBat.copy(batter.knob).addScaledVector(batter.axis, height),
      batRadiusAt(height),
    )
  })
  return Math.max(...depths)
}

/** Halves `range`, the share of the way from the pose's own head turn to a look, toward the most that clears the bat. */
export function halveClearRange(batter: Batter, pose: SwingPose, look: HeadLook, [clear, blocked]: [number, number]) {
  const middle = (clear + blocked) / 2
  turnHead(batter.rig, lerp(pose.headYaw, look.yaw, middle), lerp(pose.headPitch, look.pitch, middle))
  return batInHead(batter) > 0 ? ([clear, middle] as [number, number]) : ([middle, blocked] as [number, number])
}

/**
 * Turns the posed batter's head toward `look` (degrees, rig frame) as far as the bat lets it: a hat brim or a bob
 * turned toward the bat resting behind the head stops short, on the way from the pose's own head turn, which the
 * swing keeps clear of the bat.
 */
export function turnHeadClearOfBat(batter: Batter, pose: SwingPose, look: HeadLook) {
  turnHead(batter.rig, look.yaw, look.pitch)
  if (batInHead(batter) <= 0) return
  let range: [number, number] = [0, 1]
  for (let step = 0; step < 10; step++) range = halveClearRange(batter, pose, look, range)
  turnHead(batter.rig, lerp(pose.headYaw, look.yaw, range[0]), lerp(pose.headPitch, look.pitch, range[0]))
}
