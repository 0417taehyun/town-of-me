// Small numeric helpers shared by motion, easing, and layout code.

export function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(maximum, Math.max(minimum, value))
}

export function clamp01(value: number) {
  return clamp(value, 0, 1)
}

export function lerp(from: number, to: number, amount: number) {
  return from + (to - from) * amount
}

/** How far (0..1) to move toward a target this frame, to close on it at `rate` per second at any frame rate. */
export function dampingAlpha(rate: number, delta: number) {
  return 1 - Math.exp(-Math.max(0, rate) * Math.max(0, delta))
}

/** Moves `current` toward `target` at `rate` per second, the same at any frame rate. */
export function damp(current: number, target: number, rate: number, delta: number) {
  return lerp(current, target, dampingAlpha(rate, delta))
}

/** Eases 0..1 in and out (Hermite smoothstep). */
export function smoothstep(value: number) {
  return value * value * (3 - 2 * value)
}

/** The fractional part, always in [0, 1), so phases loop. */
export function fract(value: number) {
  return value - Math.floor(value)
}

/** The same angle in (-π, π], so turns take the short way round. */
export function wrapAngle(angle: number) {
  return Math.atan2(Math.sin(angle), Math.cos(angle))
}

/** Like `damp`, for a heading: eases `current` toward `target` at `rate` per second, turning the short way round. */
export function dampAngle(current: number, target: number, rate: number, delta: number) {
  return current + wrapAngle(target - current) * dampingAlpha(rate, delta)
}

export function seededFraction(index: number, salt: number) {
  return fract(Math.sin(index * 127.1 + salt * 311.7) * 43758.5453)
}
