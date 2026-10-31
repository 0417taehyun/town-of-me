import type { Group, Mesh } from 'three'
import { MathUtils, Vector3 } from 'three'
import type { Vec3 } from '../../../data/models'
import type { PlayerProfile } from '../../../data/playerProfile'
import { clamp, clamp01, lerp, smoothstep } from '../../../motionMath'
import { BASES, type BattingSide, CONTACT_DEPTH, STRIKE_ZONE } from '../../game/field'
import { batterSpot, PLAYER_SCALE } from '../stageLayout'
import {
  ANKLE_IN_FOOT,
  BALLPLAYER_BODY,
  type BallplayerRig,
  createBallplayerRig,
  direction,
  disposeBallplayerRig,
  type LegStance,
  poseChest,
  poseLegs,
  SHOULDER,
  shoulderPoint,
  turnHead,
} from './ballplayerRig'
import { BAT, batRadiusAt, createBat } from './bat'
import { bodyVolumes, deepestPenetration, headVolumes } from './bodyVolumes'
import { type MonotoneTrack, monotoneTrack, sampleTrack } from './keyframes'
import { fieldToRig, type HeadLook } from './headLook'
import {
  type ArmSegment,
  createMitten,
  createSettledMitten,
  MITTEN,
  placeMittens,
  searchSwivel,
  settleMitten,
} from './mittenHands'
import {
  CONTACT_DELAY_MS,
  createSwingMotion,
  FINISH_HOLD_MS,
  nearestTurn,
  RETURN_KEY_MS,
  RETURN_MS,
  sampleReturnPose,
  sampleSwingPose,
  SWING_CONSTANTS,
  SWING_KEY_TIMES,
  SWING_MS,
  type SwingMotion,
  type SwingPose,
  swingSeconds,
  WAGGLE_FADE_MS,
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

/** How a swing turns toward its ball at contact (degrees): the bat's azimuth and elevation, and the chest's lean. */
export type AimTurn = { azimuth: number; elevation: number; lean: number }

/**
 * The swing under way: when it started (game ms), the windup second it left from, the swing second its bat meets the
 * ball, its turn toward the ball then and the grip shift (rig frame) that puts the sweet spot on it, how far the head
 * tips up (degrees) to keep its eyes on that ball, and each elbow's swivel [back, front] off the swing's own by swing
 * second, solved for this aim.
 */
export type BatterSwing = {
  startMs: number
  from: number
  contactAt: number
  aimTurn: AimTurn
  aimShift: Vector3
  headLift: number
  swivelShift: [MonotoneTrack, MonotoneTrack]
}

/**
 * What the swing is aimed at before any pitch (field meters): the strike zone's center at the contact depth in front of
 * the plate's center, the depth where a PERFECT swing meets the ball with the bat square.
 */
export const CONTACT_POINT: Vec3 = { x: BASES.home.x, y: STRIKE_ZONE.center, z: BASES.home.z - CONTACT_DEPTH }
/** The grip's origin (body space): the back shoulder, the research's pivot for the hands. */
export const GRIP_ORIGIN = new Vector3(-SHOULDER.x, SHOULDER.y, SHOULDER.z)
/** Half-width (swing seconds) of the window in which a swing's own aim fades in and out round its contact. */
export const AIM_FADE_SECONDS = 0.06
/** The most a swing's aim turns the bat toward the ball (degrees); the grip shifts for the rest. */
export const AIM_TURN_LIMIT = 35
/** The most a swing's aim leans the chest toward the plate for a ball further out, or back for one closer in. */
export const AIM_LEAN_LIMIT = { toward: 10, back: 6 }
/** Swing seconds past the contact key over which a ball met out in front takes away the lean toward the plate. */
export const AIM_LEAN_EARLY_FADE = 0.026
/** How far the shoulders sit above the waist the chest leans about (rig units). */
export const SHOULDERS_OVER_WAIST = SHOULDER.y - BALLPLAYER_BODY.hipHeight - BALLPLAYER_BODY.waistUp

const UP = new Vector3(0, 1, 0)
const NO_SWIVEL_SHIFT = monotoneTrack([0], [0])
/** No swing under way: the batter stands in its windup. */
export const NO_SWING: BatterSwing = {
  startMs: -Infinity,
  from: 0,
  contactAt: 0,
  aimTurn: { azimuth: 0, elevation: 0, lean: 0 },
  aimShift: new Vector3(),
  headLift: 0,
  swivelShift: [NO_SWIVEL_SHIFT, NO_SWIVEL_SHIFT],
}

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

/**
 * Times from `from` up to `to`, `step` apart and evenly spread, so `to` is one of them: two independent solves close
 * together would turn their small differences into a sudden turn of the elbow.
 */
export function evenTimes(from: number, to: number, step: number) {
  const count = Math.max(1, Math.round((to - from) / step))
  return Array.from({ length: count + 1 }, (_, index) => lerp(from, to, index / count))
}

/** Swing seconds the elbows are solved at: about every 20 ms from the stance, every 10 ms from the foot strike. */
export function swivelSolveTimes() {
  const { stance, footStrike, finish } = SWING_KEY_TIMES
  return [...evenTimes(stance, footStrike, 0.02).slice(0, -1), ...evenTimes(footStrike, finish, 0.01)]
}

/** Ms from the finish the elbows are solved at through the held finish and the return: every 10 ms. */
export function returnSolveTimes() {
  return evenTimes(0, RETURN_KEY_MS.stance, 10)
}

const settledArm = createSettledMitten()
const armShoulder = new Vector3()

/** Arm `index`'s elbow and wrist (copies) holding the bat as last posed at `center`, swivelled `swivel` off `pole`. */
export function armAt(batter: Batter, index: number, center: Vector3, pole: Vector3, swivel: number): ArmSegment {
  const shoulder = shoulderPoint(batter.rig, index, armShoulder)
  const arm = settleMitten(settledArm, shoulder, center, batter.axis, pole, swivel)
  return { elbow: arm.elbow.clone(), wrist: arm.wrist.clone() }
}

/**
 * Both elbows' swivels [back, front] for `pose`, each searched near the last ones: the back (top hand's) arm clear of
 * where the front forearm last was, then the front one clear of it.
 */
export function solveSwivelsAt(batter: Batter, pose: SwingPose, near: [number, number]): [number, number] {
  poseBody(batter, pose)
  const volumes = bodyVolumes(batter.rig)
  const { bottom, top } = gripPoints(batter)
  const [back, front] = elbowPoles(pose)
  const frontBefore = armAt(batter, 1, bottom, front, near[1])
  const backSwivel = searchSwivel(batter.rig, 0, top, batter, back, near[0], volumes, frontBefore)
  const backArm = armAt(batter, 0, top, back, backSwivel)
  return [backSwivel, searchSwivel(batter.rig, 1, bottom, batter, front, near[1], volumes, backArm)]
}

/** Solves the swivels at each of `times`, each from the last, starting near `start`. */
export function solveSwivelRun(
  batter: Batter,
  times: number[],
  poseAt: (time: number) => SwingPose,
  start: [number, number],
) {
  const solved: [number, number][] = []
  times.forEach((time) => solved.push(solveSwivelsAt(batter, poseAt(time), solved.at(-1) ?? start)))
  return solved
}

/** A track per elbow [back, front] through `solved` swivels at `times`. */
export function swivelTracks(times: number[], solved: [number, number][]): [MonotoneTrack, MonotoneTrack] {
  return [
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

/**
 * Solves the elbows' swivels through the swing and its return once, so the arms stay off the bat, out of the head and
 * body, and clear of each other: each sample starts from the last, so the elbows move smoothly, and the return starts
 * at the finish's swivels and ends on the stance's, so neither seam jumps. Most of a new batter's cost, spent while
 * Ballplayers renders a new character or batting side.
 */
export function solveSwivels(batter: Batter) {
  const { motion } = batter
  motion.swivels = null
  motion.returnSwivels = null
  const swingTimes = swivelSolveTimes()
  const swing = solveSwivelRun(batter, swingTimes, (time) => sampleSwingPose(motion, time), [0, 0])
  const returnTimes = returnSolveTimes()
  const finish = swing[swing.length - 1]
  const returning = solveSwivelRun(batter, returnTimes, (ms) => sampleReturnPose(motion, ms), finish)
  returning[0] = finish
  returning[returning.length - 1] = swing[0]
  motion.swivels = swivelTracks(swingTimes, swing)
  motion.returnSwivels = swivelTracks(returnTimes, returning)
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

const toward = new Vector3()
const turnAxis = new Vector3()
const turned = new Vector3()

/**
 * The turn (degrees of azimuth and elevation) that points the bat as last posed, `pose`'s, from its grip toward
 * `target` (rig frame), by AIM_TURN_LIMIT at most: a batter reaches a low or an outside ball by dropping and angling
 * the barrel, its hands staying close to where the swing carries them.
 */
export function aimTurnToward(batter: Batter, pose: SwingPose, target: Vector3) {
  toward.copy(target).sub(batter.gripMiddle).normalize()
  const angle = Math.min(batter.axis.angleTo(toward), MathUtils.degToRad(AIM_TURN_LIMIT))
  turned.copy(batter.axis).applyAxisAngle(turnAxis.crossVectors(batter.axis, toward).normalize(), angle)
  return {
    azimuth: nearestTurn(MathUtils.radToDeg(Math.atan2(turned.x, turned.z)), pose.batAzimuth) - pose.batAzimuth,
    elevation: MathUtils.radToDeg(Math.asin(clamp(turned.y, -1, 1))) - pose.batElevation,
  }
}

/**
 * The chest's lean (degrees toward the plate) that carries the hands `reach` (rig units) further toward the plate, as
 * a batter bends toward an outside ball rather than straining its arms, and stands taller for an inside one. A ball met
 * out in front, at swing second `contactAt` past the contact key, meets arms already reaching forward at head height,
 * so the head leans less into their way.
 */
export function aimLean(reach: number, contactAt: number) {
  const lean = MathUtils.radToDeg(Math.asin(clamp(reach / SHOULDERS_OVER_WAIST, -1, 1)))
  const limited = clamp(lean, -AIM_LEAN_LIMIT.back, AIM_LEAN_LIMIT.toward)
  if (limited <= 0) return limited
  return limited * (1 - clamp01((contactAt - SWING_KEY_TIMES.contact) / AIM_LEAN_EARLY_FADE))
}

/**
 * When a swing meeting the ball at swing second `contactAt` starts aiming: AIM_FADE_SECONDS before, but not before the
 * slot, while the bat still passes behind the back shoulder, so a late swing turns no bat into it.
 */
export function aimStart(contactAt: number) {
  return Math.max(contactAt - AIM_FADE_SECONDS, SWING_KEY_TIMES.slot)
}

/** How much of a swing's own aim applies at swing second `time`, 0..1: all of it at its contact, `contactAt`. */
export function aimWeight(time: number, contactAt: number) {
  if (time > contactAt) return smoothstep(Math.max(0, 1 - (time - contactAt) / AIM_FADE_SECONDS))
  const start = aimStart(contactAt)
  return smoothstep(Math.max(0, (time - start) / Math.max(contactAt - start, 1e-6)))
}

/**
 * How much of a swing's lean applies at swing second `time`, 0..1, for a swing from swing second `from` meeting its ball
 * at `contactAt`: easing in over the whole way to its contact and out over the whole way to its finish, so the body
 * tilts into the ball over the swing and the head stays steady instead of lurching in a frame.
 */
export function leanWeight(time: number, from: number, contactAt: number) {
  const { finish } = SWING_KEY_TIMES
  if (time > contactAt) return smoothstep(clamp01((finish - time) / Math.max(finish - contactAt, 1e-6)))
  return smoothstep(clamp01((time - from) / Math.max(contactAt - from, 1e-6)))
}

/**
 * Swing seconds a swing meeting its ball at `contactAt` has its own elbow swivels solved at, through the window its aim
 * fades in and out over and on to the finish, where its lean has eased out: closest together for the first half after
 * its contact, as the bat rolls over and its knob sweeps past the front forearm.
 */
export function aimSolveTimes(contactAt: number) {
  const start = aimStart(contactAt)
  const before = Array.from({ length: 6 }, (_, step) => lerp(start, contactAt, step / 6))
  const rolling = Array.from({ length: 6 }, (_, step) => contactAt + (step / 12) * AIM_FADE_SECONDS)
  const after = [0.5, 0.75].map((share) => contactAt + share * AIM_FADE_SECONDS)
  const tail = evenTimes(contactAt + AIM_FADE_SECONDS, SWING_KEY_TIMES.finish, 0.02)
  return [...before, ...rolling, ...after, ...tail]
}

/**
 * Each elbow's swivel [back, front] off the swing's own through the aimed window of the swing under way, solved so the
 * arms stay clear of the bat and the body with the hands and the bat where this aim takes them; none at either end.
 */
export function solveAimedSwivels(batter: Batter): [MonotoneTrack, MonotoneTrack] {
  const times = aimSolveTimes(batter.swing.contactAt)
  const own = times.map((time) => sampleSwingPose(batter.motion, time))
  const solved = solveSwivelRun(batter, times, (time) => aimedSwingPose(batter, time), [
    own[0].backSwivel,
    own[0].frontSwivel,
  ])
  const shifts = solved.map(([back, front], index): [number, number] => [
    back - own[index].backSwivel,
    front - own[index].frontSwivel,
  ])
  shifts[0] = [0, 0]
  shifts[shifts.length - 1] = [0, 0]
  return swivelTracks(times, shifts)
}

/**
 * Starts a swing at `startMs` (game ms) from a windup at `load` whose bat meets `point` (field meters; the contact
 * point when null) CONTACT_DELAY_MS later. The start may be past: a swing reported after it was made catches up. The
 * bat turns toward the ball and the grip shifts for the rest; the head follows with its eyes, which also keeps a cap's
 * brim off a bat meeting a high pitch.
 */
export function startSwing(batter: Batter, startMs: number, load: number, point: Vec3 | null) {
  const target = fieldToRig(batter.rig, point ?? CONTACT_POINT, aimTarget)
  const contactAt = contactMoment(batter, target.x)
  const pose = sampleSwingPose(batter.motion, contactAt)
  poseBody(batter, pose)
  const headLift = lookDown(batter, batter.sweetSpot) - lookDown(batter, target)
  const aimTurn = { ...aimTurnToward(batter, pose, target), lean: 0 }
  pose.batAzimuth += aimTurn.azimuth
  pose.batElevation += aimTurn.elevation
  poseBody(batter, pose)
  aimTurn.lean = aimLean(target.z - batter.sweetSpot.z, contactAt)
  pose.chestTilt += aimTurn.lean
  poseBody(batter, pose)
  const aimShift = target.clone().sub(batter.sweetSpot)
  const { swivelShift } = NO_SWING
  batter.swing = { startMs, from: windupSeconds(load), contactAt, aimTurn, aimShift, headLift, swivelShift }
  // The elbows are solved for this aim once it is set, from the swing's own swivels.
  batter.swing.swivelShift = solveAimedSwivels(batter)
}

/**
 * The swing's pose at swing second `time`, with its own aim, head lift, and elbow swivels faded in round its contact,
 * and its lean eased in and out over the whole swing.
 */
export function aimedSwingPose(batter: Batter, time: number) {
  const { from, contactAt, aimTurn, aimShift, headLift, swivelShift } = batter.swing
  const pose = sampleSwingPose(batter.motion, time)
  const weight = aimWeight(time, contactAt)
  pose.batAzimuth += weight * aimTurn.azimuth
  pose.batElevation += weight * aimTurn.elevation
  pose.chestTilt += leanWeight(time, from, contactAt) * aimTurn.lean
  pose.gripX += weight * aimShift.x
  pose.gripY += weight * aimShift.y
  pose.gripZ += weight * aimShift.z
  pose.headPitch -= weight * headLift
  pose.backSwivel += sampleTrack(swivelShift[0], time)
  pose.frontSwivel += sampleTrack(swivelShift[1], time)
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

/** How much of the stance's waggle plays `elapsed` ms into a swing: none until it is back, then fading in. */
export function waggleAfterSwing(elapsed: number) {
  if (elapsed < 0) return 1
  return smoothstep(clamp01((elapsed - SWING_MS - FINISH_HOLD_MS - RETURN_MS) / WAGGLE_FADE_MS))
}

/**
 * The batter's pose at `nowMs` (game ms): the windup at `load` (0 stance, 0.5 toe lift, 1 front foot down) with the
 * stance's waggle fading as it loads, or the swing under way, then its held finish and its return to the stance, where
 * the game has brought the load back to 0 by then.
 */
export function batterPoseAt(batter: Batter, nowMs: number, load: number, waggle: boolean): SwingPose {
  const { startMs, from, contactAt } = batter.swing
  const elapsed = nowMs - startMs
  if (elapsed >= 0 && elapsed <= SWING_MS) return aimedSwingPose(batter, swingSeconds(from, contactAt, elapsed))
  const sinceFinish = elapsed - SWING_MS
  if (sinceFinish > 0 && sinceFinish < FINISH_HOLD_MS + RETURN_MS) return sampleReturnPose(batter.motion, sinceFinish)
  const amount = waggle ? Math.max(0, 1 - load * 2) * waggleAfterSwing(elapsed) : 0
  return sampleSwingPose(batter.motion, windupSeconds(load), { at: nowMs / 1000, amount })
}

const alongBat = new Vector3()

/** How deep the bat as last posed reaches into the head with its hair and hat (rig units), checked along its length. */
export function batInHead(batter: Batter) {
  const head = headVolumes(batter.rig)
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
