import type { TimingWindows } from './difficulty'
import { contactSeconds, type PitchPlan } from './pitch'

/**
 * Bump when a change to a scoring file (field, seededRandom, pitch, pitchSchedule, difficulty, judging, landing,
 * calibration, runPlan, derbyScore, ../statistics) could score the same run differently, so a stored run says which
 * rules judged it.
 */
export const JUDGE_VERSION = 1

/** PERFECT and GOOD put the ball in play, early and late foul it off, and too early or too late miss it. */
export type TimingId = 'perfect' | 'good' | 'early' | 'late' | 'tooEarly' | 'tooLate'

export const SWING_POWER_RANGE = { minimum: 0.5, maximum: 1.15 }
/** A key press measures no speed, so a keyboard swing hits at this power, with its bat height unknown. */
export const KEYBOARD_POWER = 0.95

/**
 * A swing's timing error in ms (minus = early): its contact moment, `contactMs` after release, less the visitor's
 * calibrated `offsetMs`, against the moment the ball reaches the contact point.
 */
export function timingErrorMs(plan: PitchPlan, contactMs: number, offsetMs: number) {
  return contactMs - offsetMs - contactSeconds(plan) * 1000
}

export function judgeTiming(errorMs: number, windows: TimingWindows): TimingId {
  const absolute = Math.abs(errorMs)
  if (absolute <= windows.perfect) return 'perfect'
  if (absolute <= windows.good) return 'good'
  const early = errorMs < 0
  if (absolute <= windows.contact) return early ? 'early' : 'late'
  return early ? 'tooEarly' : 'tooLate'
}

/**
 * A camera swing's power: its speed against the visitor's practice peak, both in shoulder widths per second. The range
 * keeps a weak practice or a wild swing from running away with it.
 */
export function swingPower(speed: number, peakSpeed: number) {
  return Math.min(SWING_POWER_RANGE.maximum, Math.max(SWING_POWER_RANGE.minimum, speed / peakSpeed))
}
