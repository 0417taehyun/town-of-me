import { type Group, Vector3 } from 'three'
import type { Vec3 } from '../../../data/models'
import { damp } from '../../../motionMath'
import { CATCHER_SPOT, PLAYER_SCALE } from '../stageLayout'
import {
  type BallplayerRig,
  basis,
  createBallplayerRig,
  direction,
  disposeBallplayerRig,
  type LegStance,
  poseChest,
  poseLegs,
  reachArm,
} from './ballplayerRig'
import { alignHand, createGlove } from './gloves'
import { fieldToRig, type HeadLook } from './headLook'
import { createMitten, MITTEN } from './mittenHands'
import { addTeamEmblem } from './teamEmblem'
import { AWAY_UNIFORM, CATCHER_PROFILE } from './teamUniforms'

// The other team's catcher, crouched deep behind the plate facing the pitcher, so his head stays under the batting
// shot's view of home plate and the strike zone. His mitt reaches for where each pitch will end up and holds the ball there; his bare
// hand waits behind his knee. The rig frame is ballplayerRig.ts's, its +z toward the pitcher; his mitt hand is the left
// (index 1, on the rig's +x).

/**
 * The squat: feet wide and turned out on their balls, knees out over the toes, the pelvis low and sitting back, the
 * chest nearly upright, so the head stays low and back.
 */
export const CATCHER_STANCE: LegStance = {
  pelvisX: 0,
  pelvisZ: -0.12,
  pelvisYaw: 0,
  pelvisTilt: 4,
  feet: [
    { x: -0.32, z: 0.05, lift: 0, yaw: -28, heel: 25, kneeAzimuth: -35, kneeFlexion: 145 },
    { x: 0.32, z: 0.05, lift: 0, yaw: 28, heel: 25, kneeAzimuth: 35, kneeFlexion: 145 },
  ],
}
export const CATCHER_CHEST = { yaw: 0, tilt: 6, side: 0, roll: 0 }
/** The mitt's half-sizes (rig units), and its wrist below and behind its center. */
export const CATCHER_MITT = { wide: 0.21, long: 0.24, thick: 0.1, wristBelow: 0.17, wristBehind: 0.05 }
/** The bare hand's wrist behind the right knee, and its elbow's pole (rig frame). */
export const BARE_HAND = { x: -0.36, y: 0.5, z: 0.12, poleAzimuth: -100, poleElevation: -30 }
/** How fast (per second) the mitt moves to where it is wanted. */
export const MITT_RATE = 9

const UP = new Vector3(0, 1, 0)
const ACROSS_THE_FIELD = new Vector3(1, 0, 0)

/** `mittPoint` is the mitt's pocket as last posed (field meters); `look` is where his head turns. */
export type Catcher = { rig: BallplayerRig; mitt: Group; hand: Group; mittPoint: Vector3; look: HeadLook }

export function createCatcher(setTarget: Vec3): Catcher {
  const rig = createBallplayerRig(CATCHER_PROFILE)
  addTeamEmblem(rig, AWAY_UNIFORM.emblem)
  rig.root.position.set(CATCHER_SPOT.x, CATCHER_SPOT.y, CATCHER_SPOT.z)
  rig.root.rotation.y = Math.PI
  rig.root.scale.setScalar(PLAYER_SCALE)
  const catcher: Catcher = {
    rig,
    mitt: createGlove(rig, CATCHER_MITT),
    hand: createMitten(rig, 0),
    mittPoint: new Vector3(setTarget.x, setTarget.y, setTarget.z),
    look: { yaw: 0, pitch: 10 },
  }
  // Fingers (+z) up and the palm (+x) toward the pitcher.
  basis(catcher.mitt.quaternion, ACROSS_THE_FIELD, UP)
  poseCatcher(catcher, setTarget, 0)
  return catcher
}

export function disposeCatcher(catcher: Catcher) {
  disposeBallplayerRig(catcher.rig)
}

const pocket = new Vector3()
const mittWrist = new Vector3()
const mittPole = new Vector3(1, -0.6, -0.2)
const barePole = new Vector3()
const bareWrist = new Vector3()

/**
 * Crouches the catcher with his mitt's pocket eased `delta` seconds toward `target` (field meters), and his bare hand
 * behind his knee. The mitt stands facing the pitcher, fingers up, with the leather just behind the ball and the wrist
 * below it.
 */
export function poseCatcher(catcher: Catcher, target: Vec3, delta: number) {
  const { rig, mitt, mittPoint } = catcher
  mittPoint.set(
    damp(mittPoint.x, target.x, MITT_RATE, delta),
    damp(mittPoint.y, target.y, MITT_RATE, delta),
    damp(mittPoint.z, target.z, MITT_RATE, delta),
  )
  poseLegs(rig, CATCHER_STANCE)
  poseChest(rig, CATCHER_CHEST, catcher.look.yaw, catcher.look.pitch)
  mitt.position.copy(fieldToRig(rig, mittPoint, pocket))
  mitt.position.z -= CATCHER_MITT.thick
  mittWrist.copy(mitt.position)
  mittWrist.y -= CATCHER_MITT.wristBelow
  mittWrist.z -= CATCHER_MITT.wristBehind
  reachArm(rig, 1, mittWrist, mittPole)
  direction(BARE_HAND.poleAzimuth, BARE_HAND.poleElevation, barePole)
  reachArm(rig, 0, bareWrist.set(BARE_HAND.x, BARE_HAND.y, BARE_HAND.z), barePole)
  alignHand(catcher.hand, rig, 0, barePole, MITTEN.wrist)
}
