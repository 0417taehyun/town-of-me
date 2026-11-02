import type { TimingWindows } from './difficulty'
import { type BattingSide, fenceDistance, FOUL_ANGLE } from './field'
import { judgeTiming, SWING_POWER_RANGE } from './judging'

// Where a swing sends the ball is decided first, from the swing alone, with arithmetic and comparisons only, so every
// engine (and later the server) lands it in the same place; flight.ts then draws a path that ends there. Nothing here
// is random: the same swing always lands the same way, so knowing a run's seed in advance gives nothing to reroll for.
// The derby has home runs, hits, and fouls, never outs.

export type Outcome = 'homeRun' | 'hit' | 'foul' | 'miss'

/**
 * A swing as the judge sees it: the timing error after calibration (ms, minus = early), the power, and the bat's height
 * against the ball at the contact point (m, plus = above it), or null when the camera lost the bat.
 */
export type JudgedSwing = { errorMs: number; power: number; heightError: number | null }

/**
 * Where the ball comes down: its distance from home plate in tenths of a meter, its spray angle (radians, plus = right
 * field), and the launch angle its drawn flight starts at (degrees; display only, never scored).
 */
export type Landing = { outcome: Outcome; distanceDecimetres: number; spray: number; launchDegrees: number }

/** The longest carry (m): a dead-on swing at full power with the bat level with the ball. */
export const LONGEST_CARRY = 155

/** Timing quality at the edge of each window; it falls in straight lines from 1 for a dead-on swing. */
export const TIMING_QUALITY = { perfectEdge: 0.835, goodEdge: 0.67, contactEdge: 0.4 }

/**
 * Height errors (m) up to `tolerance` cost nothing, then quality falls by 1 per `falloff` down to `floor`; past `miss`
 * the bat passes over or under the ball. An unknown height counts as `unknown`, a common error, never as a perfect one,
 * so not measuring never beats measuring.
 */
export const HEIGHT_RULES = { tolerance: 0.12, falloff: 0.4, floor: 0.4, miss: 0.45, unknown: 0.2 }

/** The share of the carry that needs no power; the rest grows with power up to the top of its range. */
export const POWER_BASE_SHARE = 0.6

/** Early swings pull and late ones push: fair balls spray up to `fairEdge` (radians) at the GOOD window's edge. */
export const SPRAY_RULES = { fairEdge: (35 * Math.PI) / 180, foulMinimum: 0.05, foulSpan: 0.3 }

/** A home run lands at least `clearance` m past the fence, so its drawn flight clears the hedge; a hit lands `margin` m short. */
export const FENCE_RULES = { clearance: 5, margin: 2 }

/** The drawn launch angle (degrees) rises with cleaner timing and falls when the bat tops the ball. */
export const LAUNCH_RULES = {
  base: 12,
  perTimingQuality: 18,
  perHeightMeter: 55,
  homeRun: { minimum: 30, maximum: 42 },
  hit: { minimum: 4, maximum: 50 },
  foul: { minimum: 12, maximum: 60 },
}

export const MISSED: Landing = { outcome: 'miss', distanceDecimetres: 0, spray: 0, launchDegrees: 0 }

export function landingFor(swing: JudgedSwing, windows: TimingWindows, side: BattingSide): Landing {
  const timing = judgeTiming(swing.errorMs, windows)
  if (timing === 'tooEarly' || timing === 'tooLate' || missesByHeight(swing.heightError)) return MISSED
  const mirror = side === 'left' ? -1 : 1
  const carry = carryMeters(swing, windows)
  const launch = launchDegrees(swing, windows)
  if (timing === 'early' || timing === 'late') return foulLanding(swing.errorMs, windows, mirror, carry, launch)
  return fairLanding(mirror * (swing.errorMs / windows.good) * SPRAY_RULES.fairEdge, carry, launch)
}

/** An unknown height never misses; only a measured one far off the ball does. */
export function missesByHeight(heightError: number | null) {
  return heightError !== null && Math.abs(heightError) > HEIGHT_RULES.miss
}

export function carryMeters(swing: JudgedSwing, windows: TimingWindows) {
  const powerShare = POWER_BASE_SHARE + (1 - POWER_BASE_SHARE) * (swing.power / SWING_POWER_RANGE.maximum)
  return LONGEST_CARRY * timingQuality(swing.errorMs, windows) * heightQuality(swing.heightError) * powerShare
}

export function timingQuality(errorMs: number, windows: TimingWindows) {
  const absolute = Math.abs(errorMs)
  if (absolute <= windows.perfect) return 1 - (1 - TIMING_QUALITY.perfectEdge) * (absolute / windows.perfect)
  if (absolute <= windows.good) {
    const past = (absolute - windows.perfect) / (windows.good - windows.perfect)
    return TIMING_QUALITY.perfectEdge + (TIMING_QUALITY.goodEdge - TIMING_QUALITY.perfectEdge) * past
  }
  const past = (absolute - windows.good) / (windows.contact - windows.good)
  return TIMING_QUALITY.goodEdge + (TIMING_QUALITY.contactEdge - TIMING_QUALITY.goodEdge) * past
}

export function heightQuality(heightError: number | null) {
  const absolute = Math.abs(heightError ?? HEIGHT_RULES.unknown)
  const quality = 1 - Math.max(0, absolute - HEIGHT_RULES.tolerance) / HEIGHT_RULES.falloff
  return Math.max(HEIGHT_RULES.floor, quality)
}

/** An unknown height tilts nothing; a bat above the ball (plus) tops it lower, one below it lifts it higher. */
export function launchDegrees(swing: JudgedSwing, windows: TimingWindows) {
  const timing = LAUNCH_RULES.base + LAUNCH_RULES.perTimingQuality * timingQuality(swing.errorMs, windows)
  return timing - LAUNCH_RULES.perHeightMeter * (swing.heightError ?? 0)
}

/** A ball in play is a home run only when it carries clear of the fence in its own direction; any other is a hit. */
export function fairLanding(spray: number, carry: number, launch: number): Landing {
  const fence = fenceDistance(spray)
  if (carry >= fence + FENCE_RULES.clearance) {
    return {
      outcome: 'homeRun',
      distanceDecimetres: toDecimetres(carry),
      spray,
      launchDegrees: limited(launch, 'homeRun'),
    }
  }
  const distance = Math.min(carry, fence - FENCE_RULES.margin)
  return { outcome: 'hit', distanceDecimetres: toDecimetres(distance), spray, launchDegrees: limited(launch, 'hit') }
}

/** Past the GOOD window an early swing pulls the ball outside its foul line and a late one pushes it outside the other. */
export function foulLanding(
  errorMs: number,
  windows: TimingWindows,
  mirror: number,
  carry: number,
  launch: number,
): Landing {
  const past = (Math.abs(errorMs) - windows.good) / (windows.contact - windows.good)
  const spray = (errorMs < 0 ? -mirror : mirror) * (FOUL_ANGLE + SPRAY_RULES.foulMinimum + SPRAY_RULES.foulSpan * past)
  return { outcome: 'foul', distanceDecimetres: toDecimetres(carry), spray, launchDegrees: limited(launch, 'foul') }
}

export function limited(launch: number, outcome: 'homeRun' | 'hit' | 'foul') {
  const { minimum, maximum } = LAUNCH_RULES[outcome]
  return Math.min(maximum, Math.max(minimum, launch))
}

export function toDecimetres(meters: number) {
  return Math.round(meters * 10)
}
