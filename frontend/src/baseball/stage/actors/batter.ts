import type { Group, Mesh } from 'three'
import { MathUtils, Vector3 } from 'three'
import type { Vec3 } from '../../../data/models'
import type { PlayerProfile } from '../../../data/playerProfile'
import { clamp, clamp01, damp, lerp, smoothstep } from '../../../motionMath'
import { BASES, type BattingSide, CONTACT_DEPTH, STRIKE_ZONE } from '../../game/field'
import { batterSpot, PLAYER_SCALE } from '../stageLayout'
import {
  ANKLE_IN_FOOT,
  ARM_BONES,
  ARM_RADII,
  BALLPLAYER_BODY,
  type BallplayerRig,
  createBallplayerRig,
  direction,
  disposeBallplayerRig,
  FOREARM_RADIUS,
  type LegStance,
  poseChest,
  poseLegs,
  SHOULDER,
  shoulderPoint,
  turnHead,
} from './ballplayerRig'
import { BAT, batRadiusAt, createBat } from './bat'
import { type BodyVolume, bodyVolumes, deepestPenetration, headVolumes } from './bodyVolumes'
import { limitTangents, type MonotoneTrack, monotoneTrack, sampleTrack, sampleTrackRate } from './keyframes'
import { fieldToRig, HEAD_FOLLOW_RATE, type HeadLook } from './headLook'
import {
  createMitten,
  createSettledMitten,
  MITTEN,
  parabolaOffset,
  placeMittens,
  searchSwivel,
  settleMitten,
  SWIVEL,
} from './mittenHands'
import {
  BEGUN_SWING,
  CHECK_SWING_MS,
  CONTACT_DELAY_MS,
  contactRate,
  createSwingMotion,
  FINISH_HOLD_MS,
  FOLLOW_MS,
  addSolved,
  followSeconds,
  nearestTurn,
  RETURN_KEY_MS,
  RETURN_MS,
  sampleReturnPose,
  sampleSwingPose,
  SOLVED_CHANNELS,
  type Solved,
  type SolvedChannel,
  type SolvedTracks,
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

/** How a swing turns its bat toward its ball at contact (degrees of azimuth and elevation). */
export type AimTurn = { azimuth: number; elevation: number }

/**
 * How far a swing's body goes toward its ball: the chest's turn, its tilt toward the plate and side bend toward the
 * catcher (degrees), and the pelvis's slide over the planted feet (rig units).
 */
export type BodyReach = { turn: number; tilt: number; side: number; pelvisX: number; pelvisZ: number }

/** A share of a swing's lean, easing in from swing second `from` to the swing's contact and out to its finish. */
export type Lean = { reach: BodyReach; from: number }

/**
 * The swing under way. Its aim: its leans (one from the windup second it left or where it was aimed, and one more from
 * where a swing on its way was aimed anew), the swing second its bat meets the ball, its turn toward the ball then and
 * the grip shift (rig frame) that puts the sweet spot on it, how far the head tips up (degrees) to keep its eyes on
 * that ball, and what the batter solves off its own swing's by swing second, solved for this aim. Its timing
 * (game ms): when it left the windup; its way to the ball as legs of swing seconds in the order they begin, the latest
 * one begun applying; when the bat meets the ball once it is judged, the follow-through running on from there; and for
 * a swing checked, or begun and to go back unless judged, which of its legs stops the bat, and when the bat starts back
 * to the windup and is there.
 */
export type BatterSwing = {
  leans: Lean[]
  contactAt: number
  aimTurn: AimTurn
  aimShift: Vector3
  headLift: number
  solvedShift: SolvedTracks
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
/**
 * How far a swing's body may go to bring a ball its arms would strain for within `comfort` of an arm's length: the
 * chest turns (degrees) as far as `turn` either way, `turnStep` a round, tilts as far as `toward` the plate or `back`,
 * bends `side` either way, and the pelvis slides `slide` (rig units) over the planted feet; it is solved in `rounds`.
 * The limits keep the head, which a lean and a slide carry, from rushing.
 */
export const BODY_REACH = { comfort: 0.98, turn: 24, turnStep: 6, toward: 12, back: 6, side: 8, slide: 0.09, rounds: 6 }
/**
 * Swing seconds from a swing's contact at which its arms' reach is checked, through the window its aim fades in and out
 * over: the arms reach furthest right after it.
 */
export const REACH_CHECKS = [-0.03, -0.02, -0.01, 0, 0.01, 0.02, 0.03, 0.04]
/** How far the shoulders sit above the waist the chest leans about (rig units). */
export const SHOULDERS_OVER_WAIST = SHOULDER.y - BALLPLAYER_BODY.hipHeight - BALLPLAYER_BODY.waistUp

const UP = new Vector3(0, 1, 0)
const NO_SHIFT = monotoneTrack([0], [0])
/** Nothing solved off a swing's own: every channel stays at 0. */
export const NO_SOLVED_SHIFT = Object.fromEntries(SOLVED_CHANNELS.map((channel) => [channel, NO_SHIFT])) as SolvedTracks
/** Nothing solved yet. */
export const NOTHING_SOLVED = Object.fromEntries(SOLVED_CHANNELS.map((channel) => [channel, 0])) as Solved
export const NO_REACH: BodyReach = { turn: 0, tilt: 0, side: 0, pelvisX: 0, pelvisZ: 0 }
/** No swing under way: the batter stands in its windup. */
export const NO_SWING: BatterSwing = {
  leans: [],
  contactAt: 0,
  aimTurn: { azimuth: 0, elevation: 0 },
  aimShift: new Vector3(),
  headLift: 0,
  solvedShift: NO_SOLVED_SHIFT,
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
  poseChest(rig, chest, pose.headYaw, pose.headPitch, pose.headRoll)
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

/**
 * Where the mittens of the batter posed at `pose` hold the bat, as placeMittens puts them: the top one slid up the
 * handle where tipped mittens would overlap (copies; the meshes are left placed).
 */
export function heldGrip(batter: Batter, pose: SwingPose) {
  const poles = elbowPoles(pose)
  placeMittens(batter.rig, batter.mittens, gripPoints(batter), poles, [pose.backSwivel, pose.frontSwivel])
  return { top: batter.mittens[0].position.clone(), bottom: batter.mittens[1].position.clone(), axis: batter.axis }
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

/** Swing seconds the batter is solved at: about every 20 ms from the stance, every 10 ms from the foot strike. */
export function swivelSolveTimes() {
  const { stance, footStrike, finish } = SWING_KEY_TIMES
  return [...evenTimes(stance, footStrike, 0.02).slice(0, -1), ...evenTimes(footStrike, finish, 0.01)]
}

/** Ms from the finish the batter is solved at through the held finish and the return: every 10 ms. */
export function returnSolveTimes() {
  return evenTimes(0, RETURN_KEY_MS.stance, 10)
}

const settledArm = createSettledMitten()
const armShoulder = new Vector3()

/**
 * Arm `index`'s elbow and wrist (copies) holding the bat as last posed at `center`, swivelled `swivel` off `pole`, and
 * its mitten's place and long axis.
 */
export function armAt(batter: Batter, index: number, center: Vector3, pole: Vector3, swivel: number) {
  const shoulder = shoulderPoint(batter.rig, index, armShoulder)
  const arm = settleMitten(settledArm, shoulder, center, batter.axis, pole, swivel)
  return { elbow: arm.elbow.clone(), wrist: arm.wrist.clone(), long: arm.long.clone(), center: center.clone() }
}

/** `pose` with `solved` added to it. */
export function withSolved(pose: SwingPose, solved: Solved) {
  const posed = { ...pose }
  SOLVED_CHANNELS.forEach((channel) => {
    posed[channel] += solved[channel]
  })
  return posed
}

/**
 * How far the head may turn off its keys to clear the arms, the mittens, and the bat (degrees): each way's `limit`, and
 * how far a turn goes before it costs as much as a collision `depth` (rig units) deep (`cost`), rolling about the line
 * of sight the cheapest, as it leaves the eyes on the ball; the search's steps, and the room (rig units) it keeps round
 * the head. Turning off its keys faster than `rate` degrees a game ms (through the swing, and slower on the way back)
 * costs as much as that collision again, and a run of moments is smoothed back and forth `sweeps` times, so the head
 * turns ahead of what comes near it. Following the ball, the head turns from the swing's own turn toward the eyes,
 * checked every `pathStep` degrees, only until it would touch an arm, a mitten, or the bat, and as far as the swing
 * moves those, it keeps `lead` (rig units) from them, turning away ahead of them (turnHeadClear).
 */
export const HEAD_CLEARANCE = {
  turns: {
    headRoll: { limit: 30, cost: 30 },
    headPitch: { limit: 12, cost: 12 },
    headYaw: { limit: 15, cost: 15 },
  },
  step: 2.5,
  steps: 4,
  depth: 0.002,
  room: 0.005,
  pathStep: 4,
  lead: 0.02,
  rate: { swing: 1.5, back: 0.25 },
  sweeps: 3,
}
/** How far from the head's center (rig units) a hat's brim reaches: nothing further can touch the head. */
export const HEAD_REACH = 0.85

/** A ball (rig frame). */
export type Sphere = { center: Vector3; radius: number }
/** Points along the upper arm from the shoulder (0) to the elbow (1) close enough that its balls hold its width. */
export const UPPER_ARM_SPAN = [0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1]
/** How far the head turns off its keys (degrees). */
export type HeadTurn = Pick<Solved, 'headRoll' | 'headPitch' | 'headYaw'>
export const NO_TURN: HeadTurn = { headRoll: 0, headPitch: 0, headYaw: 0 }
/** An arm as posed: its elbow, its wrist, and its mitten's long axis. */
export type PosedArm = ReturnType<typeof armAt>

/** Arm `index` holding its mitten at `center` as balls: its shoulder, upper arm, elbow, forearm, and mitten. */
export function armSpheres(batter: Batter, index: number, arm: PosedArm, center: Vector3): Sphere[] {
  const shoulder = shoulderPoint(batter.rig, index, new Vector3())
  const along = (from: Vector3, to: Vector3, share: number) => from.clone().lerp(to, share)
  const mitten = [-1, 0, 1].map((end) =>
    center.clone().addScaledVector(arm.long, MITTEN.center + end * (MITTEN.long - MITTEN.wide)),
  )
  return [
    { center: shoulder, radius: ARM_RADII.shoulder },
    ...UPPER_ARM_SPAN.map((share) => ({ center: along(shoulder, arm.elbow, share), radius: ARM_RADII.upper })),
    { center: arm.elbow, radius: ARM_RADII.elbow },
    ...[0.33, 0.67].map((share) => ({ center: along(arm.elbow, arm.wrist, share), radius: FOREARM_RADIUS })),
    ...mitten.map((point) => ({ center: point, radius: MITTEN.wide })),
  ]
}

/** The bat as last posed as balls every 4 cm along it. */
export function batSpheres(batter: Batter): Sphere[] {
  return Array.from({ length: 26 }, (_, step) => {
    const height = 0.04 * step
    return { center: batter.knob.clone().addScaledVector(batter.axis, height), radius: batRadiusAt(height) }
  })
}

/** The parts of the batter as posed by `pose` near enough its head to touch it, as balls. */
export function headNeighbours(batter: Batter, pose: SwingPose): Sphere[] {
  const { bottom, top } = heldGrip(batter, pose)
  const grip = [top, bottom]
  const [back, front] = elbowPoles(pose)
  const arms = [armAt(batter, 0, grip[0], back, pose.backSwivel), armAt(batter, 1, grip[1], front, pose.frontSwivel)]
  const head = batter.rig.head.position.clone().applyMatrix4(batter.rig.body.matrix)
  const spheres = [...arms.flatMap((arm, index) => armSpheres(batter, index, arm, grip[index])), ...batSpheres(batter)]
  return spheres.filter((sphere) => sphere.center.distanceTo(head) < HEAD_REACH + sphere.radius)
}

/** How deep (rig units, summed) `spheres` reach into the head as last turned, with `room` round it. */
export function spheresInHead(batter: Batter, spheres: Sphere[], room = HEAD_CLEARANCE.room) {
  const head: BodyVolume[] = headVolumes(batter.rig)
  return spheres.reduce((sum, sphere) => sum + deepestPenetration(head, sphere.center, sphere.radius + room), 0)
}

/** How deep (rig units, summed) `spheres` reach into the head, with its room, turned `turn` off `pose`'s. */
export function headDepth(batter: Batter, pose: SwingPose, turn: HeadTurn, spheres: Sphere[]) {
  turnHead(batter.rig, pose.headYaw + turn.headYaw, pose.headPitch + turn.headPitch, pose.headRoll + turn.headRoll)
  return spheresInHead(batter, spheres)
}

/** A neighbouring moment's head turn and how far from it (degrees) costs as much as a collision HEAD_CLEARANCE.depth. */
export type HeadNeighbour = { turn: HeadTurn; change: number }

/** What turning the head `turn` off `pose`'s costs against `spheres`, from its `neighbours`. */
export function headCost(
  batter: Batter,
  pose: SwingPose,
  turn: HeadTurn,
  neighbours: HeadNeighbour[],
  spheres: Sphere[],
) {
  const { turns, depth } = HEAD_CLEARANCE
  const away = (Object.keys(turns) as (keyof HeadTurn)[]).reduce(
    (sum, axis) =>
      sum +
      (turn[axis] / turns[axis].cost) ** 2 +
      neighbours.reduce((near, { turn: other, change }) => near + ((turn[axis] - other[axis]) / change) ** 2, 0),
    0,
  )
  return (headDepth(batter, pose, turn, spheres) / depth) ** 2 + away
}

/** The head's turn between `neighbours` with nothing in its way: their weighted middle, drawn toward its keys. */
export function restingTurn(neighbours: HeadNeighbour[]): HeadTurn {
  const { turns } = HEAD_CLEARANCE
  const weights = neighbours.map(({ change }) => 1 / (change * change))
  const middle = (axis: keyof HeadTurn) =>
    neighbours.reduce((sum, { turn }, index) => sum + turn[axis] * weights[index], 0) /
    (weights.reduce((sum, weight) => sum + weight, 0) + 1 / turns[axis].cost ** 2)
  return { headRoll: middle('headRoll'), headPitch: middle('headPitch'), headYaw: middle('headYaw') }
}

/** `turn` searched along `axis` round where it is, the rest held. */
export function searchHeadAxis(
  batter: Batter,
  pose: SwingPose,
  turn: HeadTurn,
  axis: keyof HeadTurn,
  neighbours: HeadNeighbour[],
  spheres: Sphere[],
): HeadTurn {
  const { turns, step, steps } = HEAD_CLEARANCE
  const { limit } = turns[axis]
  const trials = Array.from({ length: 2 * steps + 1 }, (_, offset) =>
    clamp(turn[axis] + (offset - steps) * step, -limit, limit),
  )
  const costs = trials.map((trial) => headCost(batter, pose, { ...turn, [axis]: trial }, neighbours, spheres))
  const best = costs.indexOf(Math.min(...costs))
  const inside = best > 0 && best < costs.length - 1
  const refined = inside ? parabolaOffset(costs[best - 1], costs[best], costs[best + 1]) : 0
  return { ...turn, [axis]: clamp(trials[best] + refined * step, -limit, limit) }
}

/**
 * The head's turn off `pose`'s keys that keeps it clear of the batter's arms, mittens, and bat (`spheres`, from
 * headNeighbours), between its `neighbours` and paying for every degree it strays from them and from its keys: where
 * nothing is in its way it rests there, else it is rolled, turned, and tipped clear.
 */
export function searchHead(batter: Batter, pose: SwingPose, neighbours: HeadNeighbour[], spheres: Sphere[]): HeadTurn {
  poseBody(batter, pose)
  const resting = restingTurn(neighbours)
  if (headDepth(batter, pose, resting, spheres) <= 0) return resting
  const axes: (keyof HeadTurn)[] = ['headRoll', 'headYaw', 'headPitch', 'headRoll']
  return axes.reduce((turn, axis) => searchHeadAxis(batter, pose, turn, axis, neighbours, spheres), resting)
}

/** The head's neighbours at moment `index` of `run` [before, after], as far as `solved` holds them. */
export function headNeighboursOf(run: SolveRun, solved: (Solved | undefined)[], index: number): HeadNeighbour[] {
  const { times, clock } = run
  const sides = [index - 1, index + 1].filter((other) => solved[other] !== undefined)
  return sides.map((other) => ({
    turn: solved[other]!,
    change: Math.max(HEAD_CLEARANCE.step, run.headRate * Math.abs(clock(times[other]) - clock(times[index]))),
  }))
}

/**
 * How fast (degrees a game ms) an elbow's swivel may turn through a swing and on its way back before it costs as much
 * as a collision SWIVEL.depth deep; the way back is smoothed at `smoothed` of its rate once a first pass found its way.
 */
export const SWIVEL_RATE = { swing: 7, back: 1.5, smoothed: 0.35 }
/** How far (swing seconds; ms on the way back) a run eases from the moments it must start and end at. */
export const RUN_ENDS_EASE = { swing: 0.06, back: 80 }

/**
 * A run of moments the batter is solved at: their times, the pose at each, the game ms each is at (`clock`), how fast
 * (SWIVEL_RATE) its elbows and (HEAD_CLEARANCE.rate) its head turn, how far it eases from its ends (RUN_ENDS_EASE),
 * and how many times it is smoothed back and forth, at `smoothing` of its rate.
 */
export type SolveRun = {
  times: number[]
  poses: SwingPose[]
  clock: (time: number) => number
  rate: number
  headRate: number
  ease: number
  sweeps: number
  smoothing: number
}

/**
 * About how many game ms from its contact a swing from the windup meeting its ball at swing second `contactAt` is at
 * swing second `time`: at the windup's pace to the ball, then slowing on to the finish (followSeconds).
 */
export function swingClock(contactAt: number) {
  const pace = windupPace(contactAt)
  const span = SWING_KEY_TIMES.finish - contactAt
  const power = (contactRate(contactAt, pace) * FOLLOW_MS) / span
  return (time: number) =>
    time <= contactAt
      ? (time - contactAt) / pace
      : FOLLOW_MS * (1 - (1 - clamp01((time - contactAt) / span)) ** (1 / power))
}

/** Each neighbour of moment `index` of `run` [before, after], as far as either exists, at what `solved` holds there. */
export function neighboursOf(
  run: SolveRun,
  solved: (Solved | undefined)[],
  index: number,
  channel: 'backSwivel' | 'frontSwivel',
) {
  const { times, rate, clock } = run
  const sides = [index - 1, index + 1].filter((other) => solved[other] !== undefined)
  return sides.map((other) => ({
    swivel: solved[other]![channel],
    change: Math.max(SWIVEL.change / 5, rate * Math.abs(clock(times[other]) - clock(times[index]))),
  }))
}

/**
 * Both elbows' swivels at moment `index` of `run`, each searched between its neighbours as `solved` holds them: the
 * back (top hand's) arm clear of where the front forearm is, then the front one clear of it.
 */
export function solveSwivelsAt(batter: Batter, run: SolveRun, solved: (Solved | undefined)[], index: number): Solved {
  const pose = run.poses[index]
  const current = solved[index] ?? solved[index - 1] ?? NOTHING_SOLVED
  poseBody(batter, pose)
  const volumes = bodyVolumes(batter.rig)
  const { bottom, top } = heldGrip(batter, withSolved(pose, current))
  const [back, front] = elbowPoles(pose)
  const frontBefore = armAt(batter, 1, bottom, front, current.frontSwivel)
  const backNear = neighboursOf(run, solved, index, 'backSwivel')
  const backSwivel = searchSwivel(batter.rig, 0, top, batter, back, backNear, volumes, frontBefore)
  const backArm = armAt(batter, 0, top, back, backSwivel)
  const frontNear = neighboursOf(run, solved, index, 'frontSwivel')
  const frontSwivel = searchSwivel(batter.rig, 1, bottom, batter, front, frontNear, volumes, backArm)
  return { ...NO_TURN, backSwivel, frontSwivel }
}

/**
 * `solved` at `times` eased, over `ease`, from what the run's first and last moments are held at (`ends`, where set),
 * so a run that must start or end where another left off (the way back from the finish, a swing's own) does.
 */
export function heldEnds(times: number[], solved: Solved[], ends: (Solved | null)[], ease: number): Solved[] {
  const [first, last] = ends
  const end = times[times.length - 1]
  return solved.map((values, index) => {
    const fromFirst = first ? 1 - smoothstep(clamp01((times[index] - times[0]) / ease)) : 0
    const fromLast = last ? 1 - smoothstep(clamp01((end - times[index]) / ease)) : 0
    const own = Math.max(0, 1 - fromFirst - fromLast)
    const blend = (channel: SolvedChannel) =>
      own * values[channel] + fromFirst * (first?.[channel] ?? 0) + fromLast * (last?.[channel] ?? 0)
    return Object.fromEntries(SOLVED_CHANNELS.map((channel) => [channel, blend(channel)])) as Solved
  })
}

/** `solved`'s swivels alone. */
export function swivelsOf(solved: Solved) {
  return { backSwivel: solved.backSwivel, frontSwivel: solved.frontSwivel }
}

/**
 * `swivels` at the `free` moments each averaged with its neighbours' (1:2:1), which irons out the search's own small
 * wobble from one moment to the next.
 */
export function smoothedSwivels(swivels: Solved[], free: number[]): Solved[] {
  const smoothed = new Set(free)
  return swivels.map((values, index) => {
    const before = swivels[index - 1] ?? values
    const after = swivels[index + 1] ?? values
    const share = smoothed.has(index) ? 0.25 : 0
    const ironed = (channel: 'backSwivel' | 'frontSwivel') =>
      values[channel] + share * (before[channel] - 2 * values[channel] + after[channel])
    return { ...values, backSwivel: ironed('backSwivel'), frontSwivel: ironed('frontSwivel') }
  })
}

/**
 * Solves the batter at each moment of `run`, from `start` on, its first and last moments held at `ends` where set: the
 * elbows first, each from the last, then smoothed back and forth (`sweeps` times, first from the end) between their
 * neighbours, so an elbow moves ahead of a narrowing way between the bat and the body instead of turning sharply once
 * there; then the head's turn clear of those arms, their mittens, and the bat, the same way (HEAD_CLEARANCE.sweeps), so
 * it tilts ahead of what comes near it; both eased from the held ends.
 */
export function solveRun(batter: Batter, run: SolveRun, start: Solved, ends: (Solved | null)[] = [null, null]) {
  const { times, poses, ease } = run
  const solved: (Solved | undefined)[] = [start, ends[0] ?? undefined, ...times.slice(1).map(() => undefined)]
  solved[times.length] = ends[1] ?? solved[times.length]
  const offset = (index: number) => index + 1
  const chain: SolveRun = {
    ...run,
    times: [times[0] - 1e-9, ...times],
    poses: [poses[0], ...poses],
    clock: (time: number) => (time < times[0] ? run.clock(times[0]) - SWIVEL.change / run.rate : run.clock(time)),
  }
  const free = [...times.keys()].filter(
    (index) => !(index === 0 && ends[0]) && !(index === times.length - 1 && ends[1]),
  )
  free.forEach((index) => (solved[offset(index)] = solveSwivelsAt(batter, chain, solved, offset(index))))
  const smoothing = { ...chain, rate: chain.rate * run.smoothing }
  const sweeps = Array.from({ length: run.sweeps }, (_, sweep) => (sweep % 2 === 0 ? [...free].reverse() : free))
  sweeps.flat().forEach((index) => (solved[offset(index)] = solveSwivelsAt(batter, smoothing, solved, offset(index))))
  const swivels = [start, ...smoothedSwivels(solved.slice(1) as Solved[], free)]
  const heads: (Solved | undefined)[] = [start, ends[0] ?? undefined, ...times.slice(1).map(() => undefined)]
  heads[times.length] = ends[1] ?? heads[times.length]
  const posed = swivels.map((values, index) => withSolved(chain.poses[index], { ...NO_TURN, ...swivelsOf(values!) }))
  const near = posed.map((pose) => {
    poseBody(batter, pose)
    return headNeighbours(batter, pose)
  })
  const turnAt = (index: number) => {
    const turn = searchHead(batter, posed[index], headNeighboursOf(chain, heads, index), near[index])
    heads[index] = { ...swivels[index]!, ...turn }
  }
  free.forEach((index) => turnAt(offset(index)))
  const headSweeps = Array.from({ length: HEAD_CLEARANCE.sweeps }, (_, sweep) =>
    sweep % 2 === 0 ? [...free].reverse() : free,
  )
  headSweeps.flat().forEach((index) => turnAt(offset(index)))
  return heldEnds(times, heads.slice(1) as Solved[], ends, ease)
}

/** A track per solved channel through `solved` at `times`. */
export function solvedTracks(times: number[], solved: Solved[]): SolvedTracks {
  return Object.fromEntries(
    SOLVED_CHANNELS.map((channel) => [
      channel,
      monotoneTrack(
        times,
        solved.map((values) => values[channel]),
      ),
    ]),
  ) as SolvedTracks
}

/**
 * Solves the batter through the swing and its return once, so the arms stay off the bat, out of the head and body, and
 * clear of each other, and the head clear of them: each run is smoothed between neighbouring moments (solveRun), so
 * the elbows and the head move smoothly, and the return starts at the finish's and ends on the stance's, so neither
 * seam jumps. Most of a new batter's cost, spent while Ballplayers renders a new character or batting side.
 */
export function solveMotion(batter: Batter) {
  const { motion } = batter
  motion.solved = null
  motion.returnSolved = null
  const swingTimes = swivelSolveTimes()
  const swingPoses = swingTimes.map((time) => sampleSwingPose(motion, time))
  const clock = swingClock(SWING_KEY_TIMES.contact)
  const swingRun = {
    times: swingTimes,
    poses: swingPoses,
    clock,
    rate: SWIVEL_RATE.swing,
    headRate: HEAD_CLEARANCE.rate.swing,
    ease: RUN_ENDS_EASE.swing,
    sweeps: 1,
    smoothing: 1,
  }
  const swing = solveRun(batter, swingRun, NOTHING_SOLVED)
  const returnTimes = returnSolveTimes()
  const finish = swing[swing.length - 1]
  const returnPoses = returnTimes.map((ms) => sampleReturnPose(motion, ms))
  const returnRun = {
    times: returnTimes,
    poses: returnPoses,
    clock: (ms: number) => ms,
    rate: SWIVEL_RATE.back,
    headRate: HEAD_CLEARANCE.rate.back,
    ease: RUN_ENDS_EASE.back,
    sweeps: 3,
    smoothing: SWIVEL_RATE.smoothed,
  }
  const returning = solveRun(batter, returnRun, finish, [finish, swing[0]])
  motion.solved = solvedTracks(swingTimes, swing)
  motion.returnSolved = solvedTracks(returnTimes, returning)
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
  solveMotion(batter)
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
 * out in front, at swing second `contactAt` past the contact key, meets arms already reaching forward, so the head
 * stays steadier and leans less into their way; the body reaches further only as far as the arms need (reachBall).
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
 * Swing seconds a swing meeting its ball at `contactAt`, leaning from swing second `from`, is solved at for its aim:
 * from where it starts leaning, through the window its aim fades in and out over, and on to the finish, where its lean
 * has eased out, as close together from there as the swing's own (swivelSolveTimes); closest while its aim fades out
 * after its contact, as the bat rolls over and its knob sweeps past the front forearm and the front elbow past the chest.
 */
export function aimSolveTimes(contactAt: number, from: number) {
  const start = aimStart(contactAt)
  const leaning = from < start ? evenTimes(from, start, 0.015).slice(0, -1) : []
  const before = Array.from({ length: 6 }, (_, step) => lerp(start, contactAt, step / 6))
  const rolling = Array.from({ length: 12 }, (_, step) => contactAt + (step / 12) * AIM_FADE_SECONDS)
  const tail = evenTimes(contactAt + AIM_FADE_SECONDS, SWING_KEY_TIMES.finish, 0.01)
  return [...leaning, ...before, ...rolling, ...tail]
}

/**
 * What the batter solves off its own swing's through the aimed window of the swing under way, solved so the arms stay
 * clear of the bat and the body, and the head of them, with the hands and the bat where this aim takes them; none at
 * either end.
 */
export function solveAimedShift(batter: Batter): SolvedTracks {
  const { motion } = batter
  const { contactAt, leans } = batter.swing
  const times = aimSolveTimes(contactAt, Math.min(...leans.map((lean) => lean.from)))
  const own = times.map((time) => addSolved({ ...NOTHING_SOLVED } as SwingPose, motion.solved, time) as Solved)
  const unsolved = (time: number) => addSolved(aimedSwingPose(batter, time), motion.solved, time, -1)
  const poses = times.map(unsolved)
  const run = {
    times,
    poses,
    clock: swingClock(contactAt),
    rate: SWIVEL_RATE.swing,
    headRate: HEAD_CLEARANCE.rate.swing,
    ease: RUN_ENDS_EASE.swing,
    sweeps: 1,
    smoothing: 1,
  }
  const solved = solveRun(batter, run, own[0], [own[0], own[own.length - 1]])
  const shifts = solved.map((values, index) => withSolved(values as SwingPose, scaled(own[index], -1)) as Solved)
  return solvedTracks(times, shifts)
}

/** `solved` times `scale`. */
export function scaled(solved: Solved, scale: number) {
  return Object.fromEntries(SOLVED_CHANNELS.map((channel) => [channel, scale * solved[channel]])) as Solved
}

/** The grip shift that puts the sweet spot of the swing under way on `target` (rig frame) at its contact. */
export function shiftOnto(batter: Batter, target: Vector3) {
  batter.swing.aimShift = new Vector3()
  poseBody(batter, aimedSwingPose(batter, batter.swing.contactAt))
  batter.swing.aimShift = target.clone().sub(batter.sweetSpot)
}

const armReach = new Vector3()
const reachedArm = createSettledMitten()

/**
 * How far (rig units) arm `index` of the batter posed at `pose` reaches past BODY_REACH's comfort of its length to its
 * mitten on the bat, and `out` the way from its shoulder to its wrist (unit).
 */
export function overreach(batter: Batter, pose: SwingPose, index: number, out: Vector3) {
  const shoulder = shoulderPoint(batter.rig, index, armShoulder)
  const { bottom, top, axis } = heldGrip(batter, pose)
  const pole = elbowPoles(pose)[index]
  const swivel = index === 0 ? pose.backSwivel : pose.frontSwivel
  const arm = settleMitten(reachedArm, shoulder, index === 0 ? top : bottom, axis, pole, swivel)
  out.copy(arm.wrist).sub(shoulder)
  const excess = out.length() - BODY_REACH.comfort * (ARM_BONES.upper + ARM_BONES.fore)
  out.normalize()
  return excess
}

/**
 * How far (rig units, rig frame) the body of the swing under way would have to lean at swing second `time` for both
 * arms to reach their mittens comfortably. A lean carries the hands with the shoulders, so it only brings them closer
 * as far as the aim's grip shift, which puts the sweet spot on the ball at contact whatever the lean, still applies.
 */
export function reachPush(batter: Batter, time: number) {
  const pose = aimedSwingPose(batter, time)
  poseBody(batter, pose)
  const push = new Vector3()
  ;[0, 1].forEach((index) => push.addScaledVector(armReach, Math.max(0, overreach(batter, pose, index, armReach))))
  const weight = aimWeight(time, batter.swing.contactAt)
  return weight < 0.2 ? push.set(0, 0, 0) : push.divideScalar(weight)
}

/**
 * `reach` moved by `push` (rig units, rig frame) as far as BODY_REACH lets it: the pelvis slides first, which carries
 * the head no further than the shoulders, and the chest leans for the rest; `leaned` is how far the swing's other
 * leans tilt the chest already.
 */
export function reachFurther(reach: BodyReach, push: Vector3, leaned: number): BodyReach {
  const { toward, back, side: sideLimit, slide } = BODY_REACH
  const pelvisX = clamp(reach.pelvisX + push.x, -slide, slide)
  const pelvisZ = clamp(reach.pelvisZ + push.z, -slide, slide)
  const tiltBy = MathUtils.radToDeg(Math.atan((push.z - pelvisZ + reach.pelvisZ) / SHOULDERS_OVER_WAIST))
  const sideBy = -MathUtils.radToDeg(Math.atan((push.x - pelvisX + reach.pelvisX) / SHOULDERS_OVER_WAIST))
  return {
    turn: reach.turn,
    tilt: clamp(reach.tilt + tiltBy, -back - leaned, toward - leaned),
    side: clamp(reach.side + sideBy, -sideLimit, sideLimit),
    pelvisX,
    pelvisZ,
  }
}

/**
 * Turns and leans the swing under way's last lean further, round by round, until its arms reach their mittens
 * comfortably round its contact with the sweet spot on `target` (rig frame), as a batter fooled out in front opens up
 * and lunges onto its front foot instead of straining its arms: the chest turns first, which leaves the head where it
 * is, then the body slides and leans for what is left. The grip shift then puts the sweet spot on `target`.
 */
export function reachBall(batter: Batter, target: Vector3) {
  const { leans, contactAt } = batter.swing
  const last = leans[leans.length - 1]
  const leaned = leans.slice(0, -1).reduce((sum, lean) => sum + lean.reach.tilt, 0)
  const times = REACH_CHECKS.map((offset) => contactAt + offset)
  for (let round = 0; round < BODY_REACH.rounds; round++) turnToReach(batter, target, last, times)
  for (let round = 0; round < BODY_REACH.rounds; round++) {
    shiftOnto(batter, target)
    const pushes = times.map((time) => reachPush(batter, time))
    const push = pushes.reduce((most, next) => (next.lengthSq() > most.lengthSq() ? next : most))
    last.reach = reachFurther(last.reach, push, leaned)
  }
  shiftOnto(batter, target)
}

/** The farthest (rig units) the arms of the swing under way reach past comfort at `times`, the grip on `target`. */
export function farthestReach(batter: Batter, target: Vector3, times: number[]) {
  shiftOnto(batter, target)
  return Math.max(...times.map((time) => reachPush(batter, time).length()))
}

/**
 * Turns `lean`'s chest a step either way (BODY_REACH.turnStep, at most `turn`) where that brings the arms of the swing
 * under way closer to their mittens round its contact: the chest turning on its spine moves a shoulder toward its hand
 * without moving the head.
 */
export function turnToReach(batter: Batter, target: Vector3, lean: Lean, times: number[]) {
  const { turn, turnStep } = BODY_REACH
  const from = lean.reach.turn
  const trials = [from, from - turnStep, from + turnStep].map((trial) => clamp(trial, -turn, turn))
  const reaches = trials.map((trial) => {
    lean.reach = { ...lean.reach, turn: trial }
    return farthestReach(batter, target, times) + 1e-4 * Math.abs(trial)
  })
  lean.reach = { ...lean.reach, turn: trials[reaches.indexOf(Math.min(...reaches))] }
}

/**
 * Aims the swing under way at `point` (field meters; the contact point when null), its leans so far (`kept`, eased
 * anew round this aim's contact) going on and one more easing in from swing second `from`: the swing second its bat
 * meets the ball there, its turn toward it, the lean toward it and the reach its arms need, the grip shift that puts
 * the sweet spot on it, the head's lift, and the elbows' swivels for that aim. Only the leans show before the slot, so
 * a swing waiting there may be aimed anew. The bat turns toward the ball and the grip shifts for the rest; the head
 * follows with its eyes, which also keeps a cap's brim off a bat meeting a high pitch.
 */
export function aimSwing(batter: Batter, point: Vec3 | null, from: number, kept: Lean[] = []) {
  const target = fieldToRig(batter.rig, point ?? CONTACT_POINT, aimTarget).clone()
  const contactAt = contactMoment(batter, target.x)
  const pose = sampleSwingPose(batter.motion, contactAt)
  poseBody(batter, pose)
  const headLift = lookDown(batter, batter.sweetSpot) - lookDown(batter, target)
  const aimTurn = aimTurnToward(batter, pose, target)
  pose.batAzimuth += aimTurn.azimuth
  pose.batElevation += aimTurn.elevation
  poseBody(batter, pose)
  const leaned = kept.reduce((sum, lean) => sum + lean.reach.tilt, 0)
  const lean = { reach: { ...NO_REACH, tilt: aimLean(target.z - batter.sweetSpot.z, contactAt) - leaned }, from }
  const { solvedShift } = NO_SWING
  const leans = [...kept, lean]
  batter.swing = { ...batter.swing, leans, contactAt, aimTurn, aimShift: new Vector3(), headLift, solvedShift }
  reachBall(batter, target)
  // The elbows and the head are solved for this aim once it is set, from the swing's own.
  batter.swing.solvedShift = solveAimedShift(batter)
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
 * saw no start of from there, and one already on its way only anew at a ball in play, keeping each lean it has eased in
 * with as far as it has (leanFromFor) and leaning on from there as far as this ball takes, so nothing jumps; its turn
 * and its grip shift show from the slot on.
 */
export function aimJudgedSwing(batter: Batter, point: Vec3 | null, seconds: number) {
  const { swing } = batter
  if (swing.legs.length === 0) return aimSwing(batter, point, seconds)
  if (!point) return
  const contactAt = contactMoment(batter, fieldToRig(batter.rig, point, aimTarget).x)
  const kept = swing.leans.map((lean) => ({
    ...lean,
    from: leanFromFor(lean.from, swing.contactAt, seconds, contactAt),
  }))
  aimSwing(batter, point, seconds, kept)
}

/**
 * The swing second a lean easing in from `from` to a contact at `before` eases in from to a contact at `contactAt`
 * instead, so that at swing second `seconds` it has leaned as far as it had: aimed anew there, it neither jumps nor
 * stops.
 */
export function leanFromFor(from: number, before: number, seconds: number, contactAt: number) {
  const share = clamp01((seconds - from) / Math.max(before - from, 1e-6))
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
  const { leans, contactAt, aimTurn, aimShift, headLift, solvedShift } = batter.swing
  const pose = sampleSwingPose(batter.motion, time)
  const weight = aimWeight(time, contactAt)
  pose.batAzimuth += weight * aimTurn.azimuth
  pose.batElevation += weight * aimTurn.elevation
  leans.forEach((lean) => leanInto(pose, lean.reach, leanWeight(time, lean.from, contactAt)))
  pose.gripX += weight * aimShift.x
  pose.gripY += weight * aimShift.y
  pose.gripZ += weight * aimShift.z
  pose.headPitch -= weight * headLift
  return addSolved(pose, solvedShift, time)
}

/** Adds `weight` of `reach` to `pose`. */
export function leanInto(pose: SwingPose, reach: BodyReach, weight: number) {
  pose.chestYaw += weight * reach.turn
  pose.chestTilt += weight * reach.tilt
  pose.chestSide += weight * reach.side
  pose.pelvisX += weight * reach.pelvisX
  pose.pelvisZ += weight * reach.pelvisZ
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

/** The head turned `share` of the way from `pose`'s own turn to `look` rolled `roll` (degrees, rig frame). */
export function turnHeadToward(batter: Batter, pose: SwingPose, look: HeadLook, roll: number, share: number) {
  const { rig } = batter
  turnHead(
    rig,
    lerp(pose.headYaw, look.yaw, share),
    lerp(pose.headPitch, look.pitch, share),
    lerp(pose.headRoll, roll, share),
  )
}

/**
 * Whether the head turned `share` of the way from `pose`'s own turn to `look`, rolled `roll`, keeps `room` from
 * `spheres`.
 */
export function headClearAt(
  batter: Batter,
  pose: SwingPose,
  look: HeadLook,
  roll: number,
  spheres: Sphere[],
  room: number,
  share: number,
) {
  turnHeadToward(batter, pose, look, roll, share)
  return spheresInHead(batter, spheres, room) <= 0
}

/**
 * The most of the way, from `from` up to `to` (shares of the way from `pose`'s own head turn, which the swing keeps
 * clear of the arms, mittens, and bat, to `look` rolled `roll`), that the head turns before a hat brim or a bob first
 * comes within `room` of one of `spheres`, so it never jumps past one to a clear turn beyond.
 */
export function clearShare(
  batter: Batter,
  pose: SwingPose,
  look: HeadLook,
  roll: number,
  spheres: Sphere[],
  room: number,
  [from, to]: [number, number],
) {
  const angle = Math.max(
    Math.abs(look.yaw - pose.headYaw),
    Math.abs(look.pitch - pose.headPitch),
    Math.abs(roll - pose.headRoll),
  )
  const count = Math.max(1, Math.ceil((angle * (to - from)) / HEAD_CLEARANCE.pathStep))
  const shares = Array.from({ length: count }, (_, step) => lerp(from, to, (step + 1) / count))
  const blocked = shares.findIndex((share) => !headClearAt(batter, pose, look, roll, spheres, room, share))
  if (blocked < 0) return to
  let range: [number, number] = [shares[blocked - 1] ?? from, shares[blocked]]
  for (let step = 0; step < 6; step++) range = halveClearRange(batter, pose, look, roll, spheres, room, range)
  return range[0]
}

/** Halves `range`, from a share of the way that keeps `room` from `spheres` to one that does not (clearShare). */
export function halveClearRange(
  batter: Batter,
  pose: SwingPose,
  look: HeadLook,
  roll: number,
  spheres: Sphere[],
  room: number,
  [clear, blocked]: [number, number],
): [number, number] {
  const middle = (clear + blocked) / 2
  return headClearAt(batter, pose, look, roll, spheres, room, middle) ? [middle, blocked] : [clear, middle]
}

/**
 * Turns the posed batter's head toward `look` (degrees, rig frame), rolled `roll` about its line of sight, as far as
 * its arms, mittens, and bat let it (clearShare), easing over `delta` seconds from `share`, how far it turned last, to
 * as far as keeps `lead` (rig units) from them, so it turns away ahead of an arm or the bat coming near; one closing in
 * faster stops it at once. Returns how far it turns now.
 */
export function turnHeadClear(
  batter: Batter,
  pose: SwingPose,
  look: HeadLook,
  roll: number,
  lead: number,
  { share, delta }: { share: number; delta: number },
) {
  const spheres = headNeighbours(batter, pose)
  const { room } = HEAD_CLEARANCE
  const kept = clearShare(batter, pose, look, roll, spheres, room + lead, [0, 1])
  const eased = damp(share, kept, HEAD_FOLLOW_RATE, delta)
  const turned = eased > kept ? clearShare(batter, pose, look, roll, spheres, room, [kept, eased]) : eased
  turnHeadToward(batter, pose, look, roll, turned)
  return turned
}
