import { type Group, Vector3 } from 'three'
import type { PlayerProfile } from '../../../data/playerProfile'
import { lerp } from '../../../motionMath'
import { PLAYER_SCALE } from '../stageLayout'
import {
  type BallplayerRig,
  createBallplayerRig,
  direction,
  type FootPlacement,
  type LegStance,
  poseChest,
  poseLegs,
  reachArm,
} from './ballplayerRig'
import { alignHand, createGlove, FIELDER_GLOVE } from './gloves'
import type { HeadLook } from './headLook'

// Everyone else on the field, on the town character's rig (ballplayerRig.ts): the other team's fielders with a glove on
// the left hand, the umpire, and our runner and teammates. Their poses are blends of a few amounts rather than keyed
// motions: standing, a fielder's ready crouch, running (its stride a phase in radians), slumping, and cheering with both
// arms up. The rig frame is ballplayerRig.ts's: +z ahead, index 0 the right side (-x).

/** How far (0..1) each part of the pose shows, the stride's phase, and the cheering arms' wave (radians). */
export type FieldPose = { crouch: number; run: number; stride: number; slump: number; cheer: number; wave: number }

export const STANDING: FieldPose = { crouch: 0, run: 0, stride: 0, slump: 0, cheer: 0, wave: 0 }

/** `look` is where the head turns; `glove` is on the left hand, or null for a player without one. */
export type FieldPlayer = { rig: BallplayerRig; glove: Group | null; look: HeadLook }

export function createFieldPlayer(profile: PlayerProfile, gloved: boolean): FieldPlayer {
  const rig = createBallplayerRig(profile)
  rig.root.scale.setScalar(PLAYER_SCALE)
  const player = { rig, glove: gloved ? createGlove(rig, FIELDER_GLOVE) : null, look: { yaw: 0, pitch: 5 } }
  poseFieldPlayer(player, STANDING)
  return player
}

/** Foot `index` (0 the right) for `pose`: planted apart, wider in the crouch, or striding through the run. */
export function fieldFoot(index: number, { crouch, run, stride, slump }: FieldPose): FootPlacement {
  const side = index === 0 ? -1 : 1
  const phase = stride + index * Math.PI
  const lift = Math.max(0, Math.cos(phase)) * run
  return {
    x: side * lerp(lerp(0.2, 0.33, crouch), 0.16, run),
    z: Math.sin(phase) * 0.38 * run + 0.04 * crouch,
    lift: lift * 0.22,
    yaw: side * (10 + 15 * crouch) * (1 - run),
    heel: lift * 30,
    kneeAzimuth: side * (8 + 25 * crouch),
    kneeFlexion: 10 + 60 * crouch + run * (25 + lift * 70) + 12 * slump,
  }
}

export function fieldStance(pose: FieldPose): LegStance {
  return {
    pelvisX: 0,
    pelvisZ: -0.06 * pose.crouch,
    pelvisYaw: 0,
    pelvisTilt: 4 + 16 * pose.crouch + 10 * pose.run,
    feet: [fieldFoot(0, pose), fieldFoot(1, pose)],
  }
}

const restWrist = new Vector3()
const blendWrist = new Vector3()

/** Where hand `index`'s wrist goes for `pose` (rig frame): at the side, before the knees, pumping, or up high. */
export function fieldWrist(index: number, { crouch, run, stride, slump, cheer, wave }: FieldPose, out: Vector3) {
  const side = index === 0 ? -1 : 1
  const pump = Math.sin(stride + index * Math.PI + Math.PI)
  out.set(side * 0.43, 0.78, 0.06)
  out.lerp(restWrist.set(side * 0.26, 0.62, 0.42), crouch)
  out.lerp(blendWrist.set(side * 0.36, 1.0, 0.12 + 0.32 * pump), run)
  out.lerp(restWrist.set(side * 0.25, 0.7, 0.3), slump)
  return out.lerp(blendWrist.set(side * 0.5, 2.2 + 0.1 * Math.sin(wave + index * Math.PI), 0.12), cheer)
}

const wrist = new Vector3()
const pole = new Vector3()

/** Poses `player` for `pose`, his head where his look last turned it. */
export function poseFieldPlayer(player: FieldPlayer, pose: FieldPose) {
  const { rig, glove, look } = player
  poseLegs(rig, fieldStance(pose))
  const tilt = 6 + 22 * pose.crouch + 14 * pose.run + 22 * pose.slump
  poseChest(rig, { yaw: 0, tilt, side: 0, roll: 0 }, look.yaw, look.pitch)
  ;[0, 1].forEach((index) => {
    direction((index === 0 ? -1 : 1) * 100, -40 + 40 * pose.cheer, pole)
    reachArm(rig, index, fieldWrist(index, pose, wrist), pole)
  })
  if (glove) alignHand(glove, rig, 1, pole, FIELDER_GLOVE.ahead)
}
