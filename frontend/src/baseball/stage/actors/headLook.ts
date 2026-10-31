import { MathUtils, Matrix4, Vector3 } from 'three'
import type { Vec3 } from '../../../data/models'
import { clamp, damp } from '../../../motionMath'
import { type BallplayerRig, turnHead } from './ballplayerRig'

// A ballplayer's eyes on the ball: the yaw and pitch (degrees in the rig frame, as poseChest takes them) that face its
// head toward a point in the field, kept within how far a neck turns and eased so the head lags a fast ball a little.

/** Yaw from +z toward +x and pitch down, in degrees in the rig frame. */
export type HeadLook = { yaw: number; pitch: number }
/** The yaw and pitch (degrees, rig frame) a ballplayer's head turns between. */
export type HeadRange = { yaw: [number, number]; pitch: [number, number] }

/** How fast (per second) a head catches up with what it watches. */
export const HEAD_FOLLOW_RATE = 14

const rootInverse = new Matrix4()
const headCenter = new Vector3()
const toPoint = new Vector3()

/** Field point `point` in the rig's frame (its root's own space); the rig's root stands straight in the field. */
export function fieldToRig(rig: Pick<BallplayerRig, 'root'>, point: Vec3, out: Vector3) {
  rig.root.updateMatrix()
  return out.set(point.x, point.y, point.z).applyMatrix4(rootInverse.copy(rig.root.matrix).invert())
}

/** The look that faces the head, as last posed, toward `point` (rig frame), kept within `range`. */
export function lookToward(rig: Pick<BallplayerRig, 'body' | 'head'>, point: Vector3, range: HeadRange): HeadLook {
  headCenter.copy(rig.head.position).applyMatrix4(rig.body.matrix)
  toPoint.copy(point).sub(headCenter)
  const yaw = MathUtils.radToDeg(Math.atan2(toPoint.x, toPoint.z))
  const pitch = MathUtils.radToDeg(Math.atan2(-toPoint.y, Math.hypot(toPoint.x, toPoint.z)))
  return { yaw: clamp(yaw, ...range.yaw), pitch: clamp(pitch, ...range.pitch) }
}

/** Eases `look` toward `target` over `delta` seconds. */
export function easeLook(look: HeadLook, target: HeadLook, delta: number) {
  look.yaw = damp(look.yaw, target.yaw, HEAD_FOLLOW_RATE, delta)
  look.pitch = damp(look.pitch, target.pitch, HEAD_FOLLOW_RATE, delta)
}

const lookPoint = new Vector3()

/** Turns a posed rig's head toward field point `point`, easing `look` there over `delta` seconds. */
export function watch(rig: BallplayerRig, look: HeadLook, point: Vec3, range: HeadRange, delta: number) {
  easeLook(look, lookToward(rig, fieldToRig(rig, point, lookPoint), range), delta)
  turnHead(rig, look.yaw, look.pitch)
}
