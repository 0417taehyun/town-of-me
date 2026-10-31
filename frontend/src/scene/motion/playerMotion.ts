import type { Object3D } from 'three'
import { clamp, damp, lerp, seededFraction } from '../../motionMath'

import type { CharacterPose } from './walkCycle'

export const PLAYER_WALK_SPEED = 4.5
export const PLAYER_RUN_SPEED = 9.6
export const SNOW_FOOTPRINT_LIFETIME = 6

export type GroundPoint = { x: number; z: number }

export function getSnowFootprintPlacement(previous: GroundPoint, current: GroundPoint, side: -1 | 1) {
  const deltaX = current.x - previous.x
  const deltaZ = current.z - previous.z
  const distance = Math.hypot(deltaX, deltaZ)
  if (distance < 0.52 || distance > 3) return null
  const lateralOffset = 0.14 * side
  return {
    x: current.x - (deltaZ / distance) * lateralOffset,
    z: current.z + (deltaX / distance) * lateralOffset,
    rotation: Math.atan2(deltaX, deltaZ),
  }
}

export function getSnowFootprintVisibility(age: number) {
  if (age <= SNOW_FOOTPRINT_LIFETIME - 2) return 1
  if (age >= SNOW_FOOTPRINT_LIFETIME) return 0
  return (SNOW_FOOTPRINT_LIFETIME - age) / 2
}

export function getPettingPose(elapsed: number) {
  return {
    rightArm: -1.05 + Math.sin(elapsed * 5) * 0.2,
    bodyLean: 0.14,
  }
}

/** Reaching down to pet the corgi: the right arm strokes and the body leans in. */
export function addPettingPose(pose: CharacterPose, elapsed: number, weight: number) {
  if (weight < 0.001) return
  const petting = getPettingPose(elapsed)
  pose.rightArm = lerp(pose.rightArm, petting.rightArm, weight)
  pose.pitch = lerp(pose.pitch, petting.bodyLean, weight)
}

export type TalkingEyeExpression = 'resting' | 'open' | 'happy' | 'blink'

export function getTalkingPose(elapsed: number, talking: boolean) {
  if (!talking) return { mouthOpen: 0, mouthWidth: 1, headNod: 0, eyeExpression: 'resting' as TalkingEyeExpression }
  const syllable = Math.abs(Math.sin(elapsed * 13))
  const expressionTime = ((elapsed % 5) + 5) % 5
  let eyeExpression: TalkingEyeExpression = 'open'
  if (expressionTime > 2.6 && expressionTime < 3.5) eyeExpression = 'happy'
  if (expressionTime > 4.8) eyeExpression = 'blink'
  return {
    mouthOpen: 0.42 + syllable * 0.48,
    mouthWidth: 1.02 - syllable * 0.12,
    headNod: Math.sin(elapsed * 3.2) * 0.025,
    eyeExpression,
  }
}

export const BLINK_SECONDS = 0.14

export const getBlinkInterval = (seed: number) => 3 + seededFraction(seed, 1) * 2.5

/** Seconds since the last blink began; `seed` offsets the rhythm so a crowd never blinks together. */
export function getSinceBlink(elapsed: number, seed: number) {
  const interval = getBlinkInterval(seed)
  return (elapsed + seededFraction(seed, 2) * interval) % interval
}

/** How shut the eyes are, 0 to 1: one quick blink every 3 to 5.5 s, paced and offset by `seed`. */
export function getBlinkAmount(elapsed: number, seed: number) {
  const sinceBlink = getSinceBlink(elapsed, seed)
  if (sinceBlink < 0 || sinceBlink > BLINK_SECONDS) return 0
  return Math.sin((sinceBlink / BLINK_SECONDS) * Math.PI)
}

/** Seconds until the next blink begins, so a canvas that draws only on demand can draw it. */
export function getSecondsUntilBlink(elapsed: number, seed: number) {
  return getBlinkInterval(seed) - getSinceBlink(elapsed, seed)
}

/** Squashes a pair of eyes toward their own centre line, like a lid, whatever their shape. */
export function closeEyes(eyes: Object3D | null, amount: number, eyeHeight: number) {
  if (!eyes) return
  eyes.scale.y = 1 - amount * 0.9
  eyes.position.y = eyeHeight * amount * 0.9
}

export function smoothPlayerVelocity(
  currentX: number,
  currentZ: number,
  targetX: number,
  targetZ: number,
  delta: number,
  result = { x: 0, z: 0 },
) {
  const response = Math.hypot(targetX, targetZ) > 0.01 ? 6 : 10
  const frameDelta = clamp(delta, 0, 0.05)
  result.x = damp(currentX, targetX, response, frameDelta)
  result.z = damp(currentZ, targetZ, response, frameDelta)
  return result
}
