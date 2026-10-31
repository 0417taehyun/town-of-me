import type { Vector3Tuple } from 'three'
import { clamp, clamp01, lerp, smoothstep } from '../motionMath'

export function dampingAlpha(lambda: number, delta: number) {
  return 1 - Math.exp(-Math.max(0, lambda) * Math.max(0, delta))
}

export function clampYaw(yaw: number, maxYaw: number) {
  return clamp(yaw, -Math.abs(maxYaw), Math.abs(maxYaw))
}

export const clampGlance = clampYaw

export function adjustFovByInputDelta(fov: number, inputDelta: number, min = 30, max = 58) {
  return clamp(fov + clamp(inputDelta, -30, 30) * 0.06, min, max)
}

export function cameraHeightForFov(fov: number) {
  return lerp(1.7, 8, smoothstep(clamp01((fov - 44) / (58 - 44))))
}

export function cameraOffset(
  yaw: number,
  height: number,
  distance: number,
  result: Vector3Tuple = [0, 0, 0],
): Vector3Tuple {
  result[0] = Math.sin(yaw) * distance
  result[1] = height
  result[2] = Math.cos(yaw) * distance
  return result
}

export function lookAheadOffset(x: number, z: number, distance: number): Vector3Tuple {
  const length = Math.hypot(x, z)
  if (length === 0) return [0, 0, 0]
  return [(x / length) * distance, 0, (z / length) * distance]
}
