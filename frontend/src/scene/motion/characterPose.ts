import type { MutableRefObject } from 'react'
import type { Group } from 'three'
import type { TownObject } from '../../data/models'
import type { CharacterAnimation } from '../characters/Characters'
import { PLAYER_RUN_SPEED, PLAYER_WALK_SPEED } from './playerMotion'
import type { CharacterPose } from './walkCycle'

const CHARACTER_SCALE = 2.2
export const CHARACTER_ORIGIN_OFFSET = -0.87
export const BENCH_SURFACE_HEIGHT = 0.7
// Both bundled rigs put hips at 0.17625 and lower the root by 0.15 in `sit`.
// Leave 8 cm for the underside of the scaled thigh above the wooden seat.
export const SEATED_ROOT_HEIGHT =
  BENCH_SURFACE_HEIGHT + 0.08 - (0.17625 - 0.15) * CHARACTER_SCALE - CHARACTER_ORIGIN_OFFSET

export type BenchSeat = { id: string; x: number; z: number; rotation: number }

export function getBenchLayout(object: TownObject) {
  return {
    width: object.seats === 1 ? 1.8 : 3.3,
    depth: 0.9,
    rotation: object.rotation,
    seatOffsets: object.seats === 1 ? [0] : [-0.75, 0.75],
  }
}

/** Seats sit along the bench's local x axis, so a rotated bench keeps both seats on its plank. */
export function getBenchSeats(objects: TownObject[]): BenchSeat[] {
  return objects
    .filter((object) => object.type === 'bench')
    .flatMap((object) => {
      const { rotation, seatOffsets } = getBenchLayout(object)
      return seatOffsets.map((offset, index) => ({
        id: index === 0 ? object.id : `${object.id}:${index + 1}`,
        x: object.position.x + offset * Math.cos(rotation),
        z: object.position.z - offset * Math.sin(rotation),
        rotation,
      }))
    })
}

export function getBenchPose(seat: BenchSeat, seated: boolean) {
  const forwardDistance = seated ? 0.06 : 1.35
  return {
    x: seat.x + Math.sin(seat.rotation) * forwardDistance,
    y: seated ? SEATED_ROOT_HEIGHT : 0.88,
    z: seat.z + Math.cos(seat.rotation) * forwardDistance,
    rotation: seat.rotation,
  }
}

/** The player's animation for how fast the body is moving. */
export function getMovementAnimation(speed: number): CharacterAnimation {
  if (speed < 0.12) return 'idle'
  return speed > 5 ? 'sprint' : 'walk'
}

/** How fast an animation moves when its owner reports no speed, as for a preview character. */
export function getAnimationSpeed(animation: CharacterAnimation) {
  if (animation === 'sprint') return PLAYER_RUN_SPEED
  return animation === 'walk' ? PLAYER_WALK_SPEED : 0
}

export type CharacterJoints = Record<
  | 'body'
  | 'head'
  | 'leftArm'
  | 'rightArm'
  | 'leftLeg'
  | 'rightLeg'
  | 'leftKnee'
  | 'rightKnee'
  | 'leftAnkle'
  | 'rightAnkle',
  MutableRefObject<Group | null>
>

/** Ankles turn the shoes to the pose's angle against the ground, so heels strike and toes push off. */
export function applyPose(joints: CharacterJoints, pose: CharacterPose, headTilt: number, headYaw: number) {
  joints.body.current?.position.set(pose.bodyX, CHARACTER_ORIGIN_OFFSET + pose.bodyY, pose.bodyZ)
  joints.body.current?.rotation.set(pose.pitch, pose.twist, pose.roll)
  // Yaw last, about the neck, so a turned head still nods and looks up along its own axis.
  joints.head.current?.rotation.set(pose.headPitch + headTilt, headYaw, 0, 'YXZ')
  joints.leftArm.current?.rotation.set(pose.leftArm, 0, pose.leftArmSpread)
  joints.rightArm.current?.rotation.set(pose.rightArm, 0, pose.rightArmSpread)
  joints.leftLeg.current?.rotation.set(pose.leftLeg, 0, pose.leftLegSpread)
  joints.rightLeg.current?.rotation.set(pose.rightLeg, 0, pose.rightLegSpread)
  joints.leftKnee.current?.rotation.set(pose.leftKnee, 0, 0)
  joints.rightKnee.current?.rotation.set(pose.rightKnee, 0, 0)
  joints.leftAnkle.current?.rotation.set(pose.leftFoot - pose.pitch - pose.leftLeg - pose.leftKnee, 0, 0)
  joints.rightAnkle.current?.rotation.set(pose.rightFoot - pose.pitch - pose.rightLeg - pose.rightKnee, 0, 0)
}
