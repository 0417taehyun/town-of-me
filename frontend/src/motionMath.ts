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

/** Moves `current` toward `target` at `rate` per second, the same at any frame rate. */
export function damp(current: number, target: number, rate: number, delta: number) {
  return lerp(current, target, 1 - Math.exp(-rate * delta))
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
  return current + wrapAngle(target - current) * (1 - Math.exp(-rate * delta))
}

export function seededFraction(index: number, salt: number) {
  return fract(Math.sin(index * 127.1 + salt * 311.7) * 43758.5453)
}
