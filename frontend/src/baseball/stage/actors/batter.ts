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
import { limitTangents, type MonotoneTrack, monotoneTrack, sampleTrack, sampleTrackRate } from './keyframes'
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
  BEGUN_SWING,
  CHECK_SWING_MS,
  CONTACT_DELAY_MS,
  contactRate,
  createSwingMotion,
  FINISH_HOLD_MS,
  FOLLOW_MS,
  followSeconds,
  nearestTurn,
  RETURN_KEY_MS,
  RETURN_MS,
  sampleReturnPose,
  sampleSwingPose,
  SWING_CONSTANTS,
  SWING_KEY_TIMES,
  type SwingMotion,
  type SwingPose,
  WAGGLE_FADE_MS,
  windupPace,
  windupSeconds,
} from './swingMotion'

// The visitor's own town character at bat (ballplayerRig.ts) with mitten hands, posed from the swing's data
// (swingMotion.ts). The game drives the windup with a load from 0 to 1. A swing the camera saw begin plays the data
// from the windup and eases into the slot (BEGUN_SWING), the bat still behind the batter, until the stage judges it or
// the visitor checks it, and goes back by itself if neither comes. A judged swing then plays its last stretch, as long
// as the stage gives it (stageRun.ts lastStretchFor), so the bat meets the ball where it is at that moment: a ball
// deeper along the pitch line is met earlier in the swing (hips less open, bat still lagging), one further out later,
// and the grip shifts by what is left. Each stretch starts where and as fast as the one before left the bat, so the bat
// never jumps or goes back. A checked swing stops short of the plate and goes back to the windup. A left-handed batter
// is the mirror image. The rig reads the game core's contact point and never the other way round: the judge decides,
// the batter shows it.

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
 * The swing under way. Its aim: the swing second its lean eases in from (the windup second it left, or where it was
 * aimed anew), the swing second its bat meets the ball, its turn toward the ball then and the grip shift (rig frame)
 * that puts the sweet spot on it, how far the head tips up (degrees) to keep its eyes on that ball, and each elbow's
 * swivel [back, front] off the swing's own by swing second, solved for this aim. Its timing (game ms): when it left the
 * windup; its way to the ball as legs of swing seconds in the order they begin, the latest one begun applying; when the
 * bat meets the ball once it is judged, the follow-through running on from there; and for a swing checked, or begun and
 * to go back unless judged, which of its legs stops the bat, and when the bat starts back to the windup and is there.
 */
export type BatterSwing = {
  from: number
  contactAt: number
  aimTurn: AimTurn
  aimShift: Vector3
  headLift: number
  swivelShift: [MonotoneTrack, MonotoneTrack]
  startMs: number
  legs: MonotoneTrack[]
  contactMs: number | null
  check: { leg: number; backFromMs: number; backMs: number } | null
}

/** Where a swing is drawn at a moment: its swing second, and how fast (swing seconds per ms) it moves on. */
export type SwingState = { seconds: number; rate: number }

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
  from: 0,
  contactAt: 0,
  aimTurn: { azimuth: 0, elevation: 0, lean: 0 },
  aimShift: new Vector3(),
  headLift: 0,
  swivelShift: [NO_SWIVEL_SHIFT, NO_SWIVEL_SHIFT],
  startMs: Infinity,
  legs: [],
  contactMs: null,
  check: null,
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
 * Aims the swing under way at `point` (field meters; the contact point when null), its lean (`lean` degrees, or what
 * the ball takes when null) easing in from swing second `from`: the swing second its bat meets the ball there, its turn
 * toward it, the grip shift that puts the sweet spot on it, the head's lift, and the elbows' swivels for that aim. Only
 * the lean shows before the slot, from `from` on, so a swing waiting there may be aimed anew. The bat turns toward the
 * ball and the grip shifts for the rest; the head follows with its eyes, which also keeps a cap's brim off a bat meeting
 * a high pitch.
 */
export function aimSwing(batter: Batter, point: Vec3 | null, from: number, lean: number | null = null) {
  const target = fieldToRig(batter.rig, point ?? CONTACT_POINT, aimTarget)
  const contactAt = contactMoment(batter, target.x)
  const pose = sampleSwingPose(batter.motion, contactAt)
  poseBody(batter, pose)
  const headLift = lookDown(batter, batter.sweetSpot) - lookDown(batter, target)
  const aimTurn = { ...aimTurnToward(batter, pose, target), lean: 0 }
  pose.batAzimuth += aimTurn.azimuth
  pose.batElevation += aimTurn.elevation
  poseBody(batter, pose)
  aimTurn.lean = lean ?? aimLean(target.z - batter.sweetSpot.z, contactAt)
  pose.chestTilt += aimTurn.lean
  poseBody(batter, pose)
  const aimShift = target.clone().sub(batter.sweetSpot)
  const { swivelShift } = NO_SWING
  batter.swing = { ...batter.swing, from, contactAt, aimTurn, aimShift, headLift, swivelShift }
  // The elbows are solved for this aim once it is set, from the swing's own swivels.
  batter.swing.swivelShift = solveAimedSwivels(batter)
}

/**
 * A leg of a swing's way (game ms to swing seconds): from `from` moving at `fromRate` at `fromMs` to `to` moving at
 * `toRate` at `toMs`, eased between without overshooting either end, and held at `to` after.
 */
export function swingLeg(fromMs: number, toMs: number, from: number, to: number, fromRate: number, toRate: number) {
  const tangents = to === from ? [0, 0] : [fromRate, toRate]
  limitTangents(tangents, (to - from) / (toMs - fromMs), 0)
  return { times: [fromMs, toMs], values: [from, to], tangents }
}

/** When (game ms) the swing under way is back in the windup: after its return once judged, else a checked one's. */
export function swingBackMs({ contactMs, check }: BatterSwing) {
  if (contactMs !== null) return contactMs + FOLLOW_MS + FINISH_HOLD_MS + RETURN_MS
  return check?.backMs ?? Infinity
}

/**
 * Where the swing under way is drawn at `nowMs` (game ms), the windup at `load` then, on its way to the ball: in the
 * windup before it starts and once it is back, along the latest leg begun, and after a checked swing's stop, on its
 * way back to the windup. A judged swing past its contact is posed from there instead (batterPoseAt).
 */
export function drawnState(batter: Batter, nowMs: number, load: number): SwingState {
  const { startMs, legs, check } = batter.swing
  const windup = { seconds: windupSeconds(load), rate: 0 }
  const index = legs.filter((candidate) => candidate.times[0] <= nowMs).length - 1
  const leg = legs.at(index)
  if (nowMs < startMs || !leg || nowMs >= swingBackMs(batter.swing)) return windup
  const onLeg = { seconds: sampleTrack(leg, nowMs), rate: sampleTrackRate(leg, nowMs) }
  if (!check || index !== check.leg || nowMs <= check.backFromMs) return onLeg
  const back = smoothstep(clamp01((nowMs - check.backFromMs) / (check.backMs - check.backFromMs)))
  return { seconds: lerp(onLeg.seconds, windup.seconds, back), rate: 0 }
}

/** The legs of a swing's way that begin before `atMs` (game ms), so a leg begun then is the latest one. */
export function legsBefore(legs: MonotoneTrack[], atMs: number) {
  return legs.filter((leg) => leg.times[0] < atMs)
}

/**
 * Begins the swing the camera saw start at `startMs` (game ms), the windup at `load` then: from where the batter is
 * drawn then, on to BEGUN_SWING's `readyAt` by `readyMs`, still moving, then easing into the slot, so a swing judged a
 * little after the camera expected it is still on its way. The visitor's swing is well under way by the time the
 * camera cues it, so the bat answers at once, half again as fast as the way's own pace. Neither judged nor checked by
 * the end of its easing, it goes back to the windup from there. It is aimed at `aim` (field meters; the contact point
 * when null), where the pitch meets a PERFECT swing, so it leans toward the ball from the start, until a ball in play
 * aims it anew (judgeSwing).
 */
export function beginSwing(batter: Batter, startMs: number, readyMs: number, load: number, aim: Vec3 | null) {
  const { seconds, rate } = drawnState(batter, startMs, load)
  const { readyAt, easeMs } = BEGUN_SWING
  const { slot } = SWING_KEY_TIMES
  const ready = Math.max(readyAt, seconds)
  const answer = Math.max(rate, (1.5 * (ready - seconds)) / (readyMs - startMs))
  const toReady = swingLeg(startMs, readyMs, seconds, ready, answer, (3 * (slot - ready)) / easeMs)
  const easing = swingLeg(readyMs, readyMs + easeMs, ready, Math.max(slot, ready), toReady.tangents[1], 0)
  const backFromMs = readyMs + easeMs
  const check = { leg: 1, backFromMs, backMs: backFromMs + CHECK_SWING_MS.backMs }
  batter.swing = { ...NO_SWING, startMs, legs: [toReady, easing], check }
  aimSwing(batter, aim, seconds)
}

/**
 * Checks the swing under way at `checkedMs` (game ms), the windup at `load` then: the bat slows to a stop no further
 * than the slot, before the plate, stays a moment, and goes back to the windup; the slower it was moving, the sooner it
 * goes back. One already on its way back goes on.
 */
export function checkSwing(batter: Batter, checkedMs: number, load: number) {
  const { check, legs } = batter.swing
  if (check && checkedMs > check.backFromMs) return
  const { seconds, rate } = drawnState(batter, checkedMs, load)
  const { stopMs, holdMs, backMs, fullStopRate } = CHECK_SWING_MS
  const moving = Math.max(0, rate)
  const share = clamp01(moving / fullStopRate)
  const stoppedMs = checkedMs + Math.max(1, stopMs * share)
  const stopAt = Math.min(SWING_KEY_TIMES.slot, seconds + (moving * (stoppedMs - checkedMs)) / 3)
  const kept = legsBefore(legs, checkedMs)
  const backFromMs = stoppedMs + holdMs * share
  batter.swing = {
    ...batter.swing,
    legs: [...kept, swingLeg(checkedMs, stoppedMs, seconds, stopAt, moving, 0)],
    check: { leg: kept.length, backFromMs, backMs: backFromMs + backMs },
  }
}

/** Moves every moment of the swing under way `byMs` (game ms) earlier, as the stage's clock was stepped back. */
export function shiftSwing(batter: Batter, byMs: number) {
  const { swing } = batter
  const legs = swing.legs.map((leg) => ({ ...leg, times: leg.times.map((time) => time - byMs) }))
  const check = swing.check && {
    ...swing.check,
    backFromMs: swing.check.backFromMs - byMs,
    backMs: swing.check.backMs - byMs,
  }
  batter.swing = { ...swing, startMs: swing.startMs - byMs, legs, check }
}

/**
 * Keeps the swing under way, judged at `atMs` (game ms), from going back to the windup (at `load` then): one begun or
 * checked goes on its way, and one already going back is held where it is drawn then, its last stretch to the ball
 * starting from rest instead of turning back in a ms.
 */
export function keepSwingOn(batter: Batter, atMs: number, load: number) {
  const { swing } = batter
  const { seconds } = drawnState(batter, atMs, load)
  const goingBack = swing.check !== null && atMs > swing.check.backFromMs
  const held = { ...swing, legs: [...swing.legs, swingLeg(atMs, atMs + 1, seconds, seconds, 0, 0)] }
  batter.swing = goingBack ? held : { ...swing, check: null }
}

/**
 * Aims the swing under way, judged as it is drawn at swing second `seconds`, at `point` (as aimSwing): one the camera
 * saw no start of from there, and one already on its way only anew at a ball in play, keeping the lean it has eased in
 * with as far as it has (leanFromFor), so only its turn and its grip shift change, which show from the slot on.
 */
export function aimJudgedSwing(batter: Batter, point: Vec3 | null, seconds: number) {
  const { swing } = batter
  if (swing.legs.length === 0) return aimSwing(batter, point, seconds)
  if (!point) return
  const contactAt = contactMoment(batter, fieldToRig(batter.rig, point, aimTarget).x)
  aimSwing(batter, point, leanFromFor(swing, seconds, contactAt), swing.aimTurn.lean)
}

/**
 * The swing second a swing met at `contactAt` eases its lean in from, so that at swing second `seconds` it has leaned
 * as far as `swing` has: aimed anew there, the lean neither jumps nor stops.
 */
export function leanFromFor(swing: BatterSwing, seconds: number, contactAt: number) {
  const share = clamp01((seconds - swing.from) / Math.max(swing.contactAt - swing.from, 1e-6))
  return (seconds - share * contactAt) / Math.max(1 - share, 1e-6)
}

/**
 * How fast (swing seconds per ms) a last stretch at `slope` on average leaves and meets the ball at swing second
 * `contactAt`, the bat moving at `rate` as it starts. From the windup it answers at once at its own pace and keeps it.
 * A swing on its way goes on as fast as it was going and speeds up smoothly, never past its speed at the ball, which is
 * at least one from the windup's (windupPace), so the swing the camera saw first is no weaker. Either way it is not so
 * fast at the start of so short a stretch that it would overshoot the ball.
 */
export function lastStretchRates(contactAt: number, slope: number, rate: number, onItsWay: boolean) {
  const speedingUp = Math.max(slope, windupPace(contactAt), (3 * slope - rate) / 2)
  const toRate = contactRate(contactAt, onItsWay ? speedingUp : slope)
  const answer = onItsWay ? rate : Math.max(rate, slope)
  return { fromRate: Math.min(answer, Math.sqrt(Math.max(0, 9 - (toRate / slope) ** 2)) * slope), toRate }
}

/**
 * Judges the swing under way: the stage took it at `takenMs` (game ms), and its bat meets `point` (field meters; null
 * for a miss, which goes where it is aimed) at `contactMs`, after a last stretch from `throughMs` (stageRun.ts
 * lastStretchFor) from where it is drawn then (the windup at `load`), as fast as it was going or faster. A stage that
 * took it later than that stretch's start stepped its clock back to it, so every earlier moment moves back with it and
 * the stretch goes on from where the bat was drawn when the stage took it; a swing going back to the windup waits
 * where it was then, and one already back is done with. A ball in play aims the swing anew (aimJudgedSwing).
 */
export function judgeSwing(
  batter: Batter,
  takenMs: number,
  throughMs: number,
  contactMs: number,
  point: Vec3 | null,
  load: number,
) {
  shiftSwing(batter, Math.max(0, takenMs - throughMs))
  const takenAtMs = Math.min(takenMs, throughMs)
  if (takenAtMs >= swingBackMs(batter.swing)) batter.swing = NO_SWING
  keepSwingOn(batter, takenAtMs, load)
  const state = drawnState(batter, throughMs, load)
  aimJudgedSwing(batter, point, state.seconds)
  const { contactAt, startMs } = batter.swing
  const legs = legsBefore(batter.swing.legs, throughMs)
  const slope = (contactAt - state.seconds) / (contactMs - throughMs)
  const { fromRate, toRate } = lastStretchRates(contactAt, slope, state.rate, legs.length > 0)
  const through = swingLeg(throughMs, contactMs, state.seconds, contactAt, fromRate, toRate)
  batter.swing = { ...batter.swing, startMs: Math.min(startMs, throughMs), legs: [...legs, through], contactMs }
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
 * swing's start and out over its return, or a checked swing's way back.
 */
export function swingHeadWeight(batter: Batter, nowMs: number) {
  const { startMs, check, contactMs } = batter.swing
  const backMs = swingBackMs(batter.swing)
  if (nowMs < startMs || nowMs > backMs) return 0
  const returnMs = check && contactMs === null ? check.backMs - check.backFromMs : RETURN_MS
  return smoothstep(Math.min((nowMs - startMs) / CONTACT_DELAY_MS, 1, (backMs - nowMs) / returnMs))
}

/** How much of the stance's waggle plays at `nowMs` (game ms): all before a swing, none until it is back, then more. */
export function waggleAfterSwing(swing: BatterSwing, nowMs: number) {
  if (nowMs < swing.startMs) return 1
  return smoothstep(clamp01((nowMs - swingBackMs(swing)) / WAGGLE_FADE_MS))
}

/** The windup at `load` at `nowMs` (game ms), its waggle (when `waggle` says it plays) fading as the batter loads. */
export function windupPose(batter: Batter, nowMs: number, load: number, waggle: boolean) {
  const amount = waggle ? Math.max(0, 1 - load * 2) * waggleAfterSwing(batter.swing, nowMs) : 0
  return sampleSwingPose(batter.motion, windupSeconds(load), { at: nowMs / 1000, amount })
}

/**
 * The judged swing's pose `sinceContact` ms after its bat met the ball: on through the finish at the pace its last
 * stretch met the ball at, its held finish and its return to the stance, then the windup at `load` at `nowMs`.
 */
export function afterContactPose(batter: Batter, sinceContact: number, nowMs: number, load: number, waggle: boolean) {
  const { contactAt, legs } = batter.swing
  const rate = legs.at(-1)?.tangents[1] ?? 0
  if (sinceContact <= FOLLOW_MS) return aimedSwingPose(batter, followSeconds(contactAt, rate, sinceContact))
  const sinceFinish = sinceContact - FOLLOW_MS
  if (sinceFinish < FINISH_HOLD_MS + RETURN_MS) return sampleReturnPose(batter.motion, sinceFinish)
  return windupPose(batter, nowMs, load, waggle)
}

/**
 * The batter's pose at `nowMs` (game ms): the windup at `load` (0 stance, 0.5 toe lift, 1 front foot down) with the
 * stance's waggle fading as it loads, or the swing under way: on its way to the ball as drawn, then from the ball
 * through its held finish and its return to the stance, where the game has brought the load back to 0 by then; a
 * checked swing goes back to the windup instead.
 */
export function batterPoseAt(batter: Batter, nowMs: number, load: number, waggle: boolean): SwingPose {
  const { swing } = batter
  const sinceContact = nowMs - (swing.contactMs ?? Infinity)
  if (sinceContact >= 0) return afterContactPose(batter, sinceContact, nowMs, load, waggle)
  const drawn = nowMs >= swing.startMs && nowMs < swingBackMs(swing)
  if (drawn) return aimedSwingPose(batter, drawnState(batter, nowMs, load).seconds)
  return windupPose(batter, nowMs, load, waggle)
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
