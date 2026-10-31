import type { Vec3 } from '../../data/models'
import { BATTER_REACH, CONTACT_DEPTH } from './field'

// A pitch flies on a fixed parabola from the release point through its target at the plate. Nothing names the pitch
// type while it flies; the visitor tells them apart by path, speed, and spin, and the result banner names it afterwards.

export const PITCH_TYPE_IDS = ['fastball', 'changeup', 'curve'] as const
export type PitchTypeId = (typeof PITCH_TYPE_IDS)[number]

/**
 * `drop` and `sideBreak` (m) are how far the ball ends up from the line it left the hand along, so its acceleration is
 * 2D/T² and a pitch keeps its shape at every pace. `sideBreak` is field x for the right-handed pitcher (arm side is
 * third base, -x). `timeMultiplier` stretches the difficulty's flight time. The differences are about 1.5-2.5 times real
 * ones (2025 Statcast) so they read on screen.
 */
export type PitchType = { drop: number; sideBreak: number; timeMultiplier: number }

export const PITCH_TYPES = {
  fastball: { drop: 0.3, sideBreak: 0, timeMultiplier: 1 },
  changeup: { drop: 1, sideBreak: -0.3, timeMultiplier: 1.25 },
  curve: { drop: 2, sideBreak: 0.7, timeMultiplier: 1.4 },
} satisfies Record<PitchTypeId, PitchType>

/** Every pitch leaves the hand here. A judging constant: the pitcher's throw is posed to hand the ball off at it. */
export const RELEASE_POINT: Vec3 = { x: -0.3, y: 1.95, z: -17.6 }

/** Where a pitch crosses the plate (z = 0): sideways `x` and height `y`, in meters. */
export type PlateTarget = { x: number; y: number }

export type PitchPlan = { release: Vec3; velocity: Vec3; acceleration: Vec3; flightSeconds: number }

/** A `type` pitch that crosses the plate at `target`; `baseFlightSeconds` is the fastball's flight at this pace. */
export function planPitch(type: PitchTypeId, baseFlightSeconds: number, target: PlateTarget): PitchPlan {
  const { drop, sideBreak, timeMultiplier } = PITCH_TYPES[type]
  const flightSeconds = baseFlightSeconds * timeMultiplier
  const squared = flightSeconds * flightSeconds
  const release = { ...RELEASE_POINT }
  // Aim the release velocity `drop` above and `sideBreak` beside the target, which the acceleration then makes up.
  return {
    release,
    velocity: {
      x: (target.x - release.x - sideBreak) / flightSeconds,
      y: (target.y - release.y + drop) / flightSeconds,
      z: -release.z / flightSeconds,
    },
    acceleration: { x: (2 * sideBreak) / squared, y: (-2 * drop) / squared, z: 0 },
    flightSeconds,
  }
}

export function pitchPosition(plan: PitchPlan, seconds: number): Vec3 {
  const half = 0.5 * seconds * seconds
  return {
    x: plan.release.x + plan.velocity.x * seconds + plan.acceleration.x * half,
    y: plan.release.y + plan.velocity.y * seconds + plan.acceleration.y * half,
    z: plan.release.z + plan.velocity.z * seconds + plan.acceleration.z * half,
  }
}

/** Seconds after release that the ball is `depth` m in front of the plate center; it nears the plate at a steady speed. */
export function secondsAtDepth(plan: PitchPlan, depth: number) {
  return (-depth - plan.release.z) / plan.velocity.z
}

/**
 * Seconds after release that the ball reaches the contact point: the one reference for PERFECT. Timing errors, the
 * calibration, the HUD timing cue, the late limit, and the batter's contact all measure from it.
 */
export function contactSeconds(plan: PitchPlan) {
  return secondsAtDepth(plan, CONTACT_DEPTH)
}

/**
 * When a bat swung to meet the ball `swingSeconds` after release does meet it: then, unless the ball is out of reach,
 * in which case where it comes within reach. An early swing meets it at the front of the reach a little later and a
 * late one at the back a little earlier, so the ball never jumps.
 */
export function meetSeconds(plan: PitchPlan, swingSeconds: number) {
  const depth = -pitchPosition(plan, swingSeconds).z
  return secondsAtDepth(plan, Math.min(BATTER_REACH.front, Math.max(BATTER_REACH.back, depth)))
}
