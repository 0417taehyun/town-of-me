import { type Group, Vector3 } from 'three'
import type { Vec3 } from '../../../data/models'
import { RELEASE_POINT } from '../../game/pitch'
import { PITCHER_SPOT, PLAYER_SCALE } from '../stageLayout'
import {
  ARM_BONES,
  type BallplayerRig,
  createBallplayerRig,
  direction,
  disposeBallplayerRig,
  type LegStance,
  placeArm,
  poseChest,
  poseLegs,
  reachArm,
  shoulderPoint,
} from './ballplayerRig'
import { alignHand, createGlove, FIELDER_GLOVE } from './gloves'
import type { HeadLook } from './headLook'
import { createMitten, MITTEN } from './mittenHands'
import { keyedTracks, type MonotoneTrack, sampleTracks } from './keyframes'
import { addTeamEmblem } from './teamEmblem'
import { AWAY_UNIFORM, PITCHER_PROFILE } from './teamUniforms'
import { solveTwoBone } from './twoBoneIk'

// The other team's right-handed pitcher on the rubber, facing home, keyed like the batter's swing (swingMotion.ts):
// set, leg lift and coil, the hands breaking as he strides, the arm cocked as the front foot lands, the throw, the
// follow-through, a fielder's stance, then two steps back to the rubber. Times are seconds from the release. The
// throwing hand is keyed in the rig frame, and its release key is the game core's RELEASE_POINT itself: the pitcher is
// posed to hand the ball off where every pitch starts, and the game never reads him.
//
// The rig frame is ballplayerRig.ts's: town units, the origin on the rubber at the mound's top, +z toward home, so the
// throwing (right) arm and the pivot foot are index 0 on -x.

export const PITCHER_KEY_IDS = [
  'set',
  'lift',
  'handBreak',
  'footStrike',
  'release',
  'follow',
  'fielding',
  'fieldingHeld',
  'stepBack',
  'stepIn',
  'reset',
] as const
export type PitcherKeyId = (typeof PITCHER_KEY_IDS)[number]

/** The windup (DERBY_PHASE_MS.windup) runs from the set to the release; every later key plays out before the next. */
export const PITCHER_KEY_TIMES: Record<PitcherKeyId, number> = {
  set: -0.9,
  lift: -0.6,
  handBreak: -0.38,
  footStrike: -0.14,
  release: 0,
  follow: 0.16,
  fielding: 0.5,
  fieldingHeld: 1.3,
  stepBack: 1.55,
  stepIn: 1.78,
  reset: 2,
}

/** The release point in the pitcher's rig frame. */
export const RELEASE_IN_RIG: Vec3 = {
  x: (RELEASE_POINT.x - PITCHER_SPOT.x) / PLAYER_SCALE,
  y: (RELEASE_POINT.y - PITCHER_SPOT.y) / PLAYER_SCALE,
  z: (RELEASE_POINT.z - PITCHER_SPOT.z) / PLAYER_SCALE,
}

/**
 * Each channel's value at each key, in PITCHER_KEY_IDS order: the pelvis, the chest about its tilted spine, each foot's
 * ball with its lift, toe turn, and knee (as in ballplayerRig.ts's LegStance), the back heel's lift, the ball held in the
 * throwing hand and the glove hand's wrist (rig frame), and each elbow's pole. The hand reaches furthest toward home
 * after the release, so it is still driving forward as it lets go. The reset repeats the set, so pitches run on.
 */
export const PITCHER_KEYS = {
  pelvisX: [0, -0.02, -0.02, 0, 0, 0.02, 0, 0, 0, 0, 0],
  pelvisZ: [0.02, 0.04, 0.14, 0.3, 0.32, 0.42, 0.55, 0.55, 0.38, 0.16, 0.02],
  pelvisYaw: [0, -75, -68, -25, 15, 40, 0, 0, 0, 0, 0],
  pelvisTilt: [4, 0, -2, 4, 6, 10, 8, 8, 6, 5, 4],
  chestYaw: [0, -80, -86, -58, 10, 45, 0, 0, 0, 0, 0],
  chestTilt: [8, 0, -4, 6, 20, 42, 22, 22, 12, 9, 8],
  chestSide: [0, 2, 4, -6, -25, -10, 0, 0, 0, 0, 0],
  backFootX: [-0.18, -0.12, -0.12, -0.14, -0.13, -0.05, -0.24, -0.24, -0.21, -0.18, -0.18],
  backFootZ: [0, 0.02, 0.02, 0.02, 0, 0.2, 0.55, 0.55, 0.28, 0, 0],
  backFootLift: [0, 0, 0, 0, 0, 0.16, 0, 0, 0.12, 0, 0],
  backFootYaw: [-8, -85, -85, -60, -25, 10, -10, -10, -8, -8, -8],
  backHeel: [0, 0, 0, 20, 50, 60, 0, 0, 10, 0, 0],
  backKneeAzimuth: [-10, -60, -40, -10, 0, 0, -15, -15, -10, -10, -10],
  backKnee: [15, 20, 25, 25, 15, 70, 40, 40, 50, 20, 15],
  frontFootX: [0.18, -0.3, 0.1, 0.12, 0.12, 0.12, 0.22, 0.22, 0.22, 0.2, 0.18],
  frontFootZ: [0.05, 0.3, 0.4, 0.62, 0.62, 0.62, 0.66, 0.66, 0.66, 0.32, 0.05],
  frontFootLift: [0, 0.4, 0.12, 0, 0, 0, 0, 0, 0, 0.12, 0],
  frontFootYaw: [10, -60, 20, 25, 25, 25, 15, 15, 15, 12, 10],
  frontKneeAzimuth: [10, -80, -10, 10, 10, 15, 15, 15, 15, 12, 10],
  frontKnee: [15, 100, 60, 35, 12, 30, 40, 40, 25, 50, 15],
  ballX: [-0.03, -0.3, -0.48, -0.47, RELEASE_IN_RIG.x, 0.3, -0.12, -0.12, -0.08, -0.05, -0.03],
  ballY: [1.02, 1.2, 0.85, 1.78, RELEASE_IN_RIG.y, 0.68, 0.86, 0.86, 0.95, 1.0, 1.02],
  ballZ: [0.36, 0.06, -0.36, -0.24, RELEASE_IN_RIG.z, 1.6, 0.86, 0.86, 0.62, 0.45, 0.36],
  ballPoleAzimuth: [-110, -150, 180, -120, -90, -40, -110, -110, -110, -110, -110],
  ballPoleElevation: [-60, -40, 20, 0, -30, -40, -60, -60, -60, -60, -60],
  gloveX: [0.05, -0.26, 0.15, 0.25, 0.32, 0.35, 0.14, 0.14, 0.12, 0.08, 0.05],
  gloveY: [1.0, 1.18, 1.15, 1.28, 1.02, 0.94, 0.88, 0.88, 0.95, 0.99, 1.0],
  gloveZ: [0.3, 0.12, 0.55, 0.68, 0.48, 0.5, 0.82, 0.82, 0.6, 0.4, 0.3],
  glovePoleAzimuth: [110, 60, 90, 90, 90, 90, 110, 110, 110, 110, 110],
  glovePoleElevation: [-60, -50, -40, -40, -50, -50, -60, -60, -60, -60, -60],
} satisfies Record<string, number[]>

type PitcherChannel = keyof typeof PITCHER_KEYS
export type PitcherPose = Record<PitcherChannel, number>

/** From the throwing hand's wrist to the ball's center along the forearm: at the mitten's fingertips. */
export const BALL_HOLD = 0.16

/** `ballPoint` is where the ball in his hand is as last posed (field meters); `look` is where his head turns. */
export type Pitcher = {
  rig: BallplayerRig
  hand: Group
  glove: Group
  tracks: Record<PitcherChannel, MonotoneTrack>
  ballPoint: Vector3
  look: HeadLook
}

export function createPitcher(): Pitcher {
  const rig = createBallplayerRig(PITCHER_PROFILE)
  addTeamEmblem(rig, AWAY_UNIFORM.emblem)
  rig.root.position.set(PITCHER_SPOT.x, PITCHER_SPOT.y, PITCHER_SPOT.z)
  rig.root.scale.setScalar(PLAYER_SCALE)
  const tracks = keyedTracks(
    PITCHER_KEY_IDS.map((id) => PITCHER_KEY_TIMES[id]),
    PITCHER_KEYS,
  )
  const pitcher: Pitcher = {
    rig,
    hand: createMitten(rig, 0),
    glove: createGlove(rig, FIELDER_GLOVE),
    tracks,
    ballPoint: new Vector3(),
    look: { yaw: 0, pitch: 5 },
  }
  posePitcher(pitcher, PITCHER_KEY_TIMES.set)
  return pitcher
}

export function disposePitcher(pitcher: Pitcher) {
  disposeBallplayerRig(pitcher.rig)
}

export function samplePitcherPose(pitcher: Pitcher, seconds: number): PitcherPose {
  return sampleTracks(pitcher.tracks, seconds)
}

export function pitcherStance(pose: PitcherPose): LegStance {
  return {
    pelvisX: pose.pelvisX,
    pelvisZ: pose.pelvisZ,
    pelvisYaw: pose.pelvisYaw,
    pelvisTilt: pose.pelvisTilt,
    feet: [
      {
        x: pose.backFootX,
        z: pose.backFootZ,
        lift: pose.backFootLift,
        yaw: pose.backFootYaw,
        heel: pose.backHeel,
        kneeAzimuth: pose.backKneeAzimuth,
        kneeFlexion: pose.backKnee,
      },
      {
        x: pose.frontFootX,
        z: pose.frontFootZ,
        lift: pose.frontFootLift,
        yaw: pose.frontFootYaw,
        heel: 0,
        kneeAzimuth: pose.frontKneeAzimuth,
        kneeFlexion: pose.frontKnee,
      },
    ],
  }
}

const holdShoulder = new Vector3()
const heldBall = new Vector3()

/**
 * The throwing arm reaching the ball at `ball` (rig frame) with its elbow toward `pole`: the forearm and the hold to
 * the ball's center are one bone for the reach, so the ball lands on its target exactly, stretching the arm evenly if
 * it must. Leaves the ball's center in `heldBall`.
 */
export function holdBall(rig: BallplayerRig, ball: Vector3, pole: Vector3) {
  const shoulder = shoulderPoint(rig, 0, holdShoulder)
  const forearmAndHold = ARM_BONES.fore + BALL_HOLD
  solveTwoBone(shoulder, ball, ARM_BONES.upper, forearmAndHold, pole, rig.elbows[0], heldBall, true)
  rig.wrists[0].copy(rig.elbows[0]).lerp(heldBall, ARM_BONES.fore / forearmAndHold)
  placeArm(rig, 0, shoulder, pole)
  return heldBall
}

const ballTarget = new Vector3()
const gloveTarget = new Vector3()
const ballPole = new Vector3()
const glovePole = new Vector3()

/** Poses the pitcher `seconds` from a release (outside the keys he holds his set) and finds the ball in his hand. */
export function posePitcher(pitcher: Pitcher, seconds: number) {
  const { rig } = pitcher
  const pose = samplePitcherPose(pitcher, seconds)
  poseLegs(rig, pitcherStance(pose))
  const chest = { yaw: pose.chestYaw, tilt: pose.chestTilt, side: pose.chestSide, roll: 0 }
  poseChest(rig, chest, pitcher.look.yaw, pitcher.look.pitch)
  direction(pose.ballPoleAzimuth, pose.ballPoleElevation, ballPole)
  holdBall(rig, ballTarget.set(pose.ballX, pose.ballY, pose.ballZ), ballPole)
  alignHand(pitcher.hand, rig, 0, ballPole, MITTEN.wrist)
  direction(pose.glovePoleAzimuth, pose.glovePoleElevation, glovePole)
  reachArm(rig, 1, gloveTarget.set(pose.gloveX, pose.gloveY, pose.gloveZ), glovePole)
  alignHand(pitcher.glove, rig, 1, glovePole, FIELDER_GLOVE.ahead)
  rig.root.updateMatrix()
  pitcher.ballPoint.copy(heldBall).applyMatrix4(rig.root.matrix)
}
