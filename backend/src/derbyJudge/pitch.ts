import type { TownVector } from '../town.js'
import { CONTACT_DEPTH } from './field.js'

// Mirrors frontend/src/baseball/game/pitch.ts, the part scoring reads: a pitch flies on a fixed parabola from the
// release point through its target at the plate.

export const PITCH_TYPE_IDS = ['fastball', 'changeup', 'curve'] as const
export type PitchTypeId = (typeof PITCH_TYPE_IDS)[number]

/**
 * `drop` and `sideBreak` (m) are how far the ball ends up from the line it left the hand along, so its acceleration is
 * 2D/T². `timeMultiplier` stretches the difficulty's flight time.
 */
export type PitchType = { drop: number; sideBreak: number; timeMultiplier: number }

export const PITCH_TYPES = {
  fastball: { drop: 0.3, sideBreak: 0, timeMultiplier: 1 },
  changeup: { drop: 1, sideBreak: -0.3, timeMultiplier: 1.25 },
  curve: { drop: 2, sideBreak: 0.7, timeMultiplier: 1.4 },
} satisfies Record<PitchTypeId, PitchType>

/** Every pitch leaves the hand here. */
export const RELEASE_POINT: TownVector = { x: -0.3, y: 1.95, z: -17.6 }

/** Where a pitch crosses the plate (z = 0): sideways `x` and height `y`, in meters. */
export type PlateTarget = { x: number; y: number }

export type PitchPlan = { release: TownVector; velocity: TownVector; acceleration: TownVector; flightSeconds: number }

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

/** Seconds after release that the ball is `depth` m in front of the plate center; it nears the plate at a steady speed. */
export function secondsAtDepth(plan: PitchPlan, depth: number) {
  return (-depth - plan.release.z) / plan.velocity.z
}

/** Seconds after release that the ball reaches the contact point: the one reference for PERFECT. */
export function contactSeconds(plan: PitchPlan) {
  return secondsAtDepth(plan, CONTACT_DEPTH)
}
