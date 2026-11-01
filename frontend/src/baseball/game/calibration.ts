import { median, percentile } from '../statistics'

// The visitor's practice swings set two things a run is judged with: how late their swings register (the camera's
// delay, a habit of swinging early) and how fast their own full swing is. Both come from the raw practice log alone,
// so a server can calibrate the same run the same way instead of trusting a client's numbers.

/**
 * One practice swing: its timing error against the practice pitch's contact moment (ms, minus = early, before any
 * offset) and its top speed in shoulder widths per second.
 */
export type PracticeSample = { errorMs: number; speed: number }

/** `offsetMs` comes off every swing's timing error; a swing's power is its speed against `peakSpeed`. */
export type Calibration = { offsetMs: number; peakSpeed: number }

export const CALIBRATION_RULES = {
  /** A practice swing further off than this (ms) was no attempt at the pitch: neither its timing nor speed counts. */
  validErrorMs: 400,
  /** Fewer valid swings than this cannot tell a habit from chance, so the offset stays 0. */
  minimumValidSwings: 3,
  /** The offset stays within a webcam's plausible delay and a hasty swinger's lead (ms). */
  offsetRange: { minimum: -150, maximum: 300 },
  /** The practice speed that stands for the visitor's full swing: near the top, not the single wildest one. */
  peakPercentile: 0.9,
  /** Shoulder widths per second: swinging gently in practice cannot make full power easy afterwards. */
  peakFloor: 5,
}

export function calibrate(practice: readonly PracticeSample[]): Calibration {
  const valid = practice.filter(isValidPracticeSwing)
  return { offsetMs: timingOffset(valid), peakSpeed: peakSpeed(valid) }
}

export function isValidPracticeSwing(sample: PracticeSample) {
  return Math.abs(sample.errorMs) <= CALIBRATION_RULES.validErrorMs
}

/** The median error of the valid swings, so one fluke does not move it. */
export function timingOffset(valid: readonly PracticeSample[]) {
  if (valid.length < CALIBRATION_RULES.minimumValidSwings) return 0
  const { minimum, maximum } = CALIBRATION_RULES.offsetRange
  return Math.min(maximum, Math.max(minimum, median(valid.map((sample) => sample.errorMs))))
}

export function peakSpeed(valid: readonly PracticeSample[]) {
  const speeds = valid.map((sample) => sample.speed)
  if (speeds.length === 0) return CALIBRATION_RULES.peakFloor
  return Math.max(CALIBRATION_RULES.peakFloor, percentile(speeds, CALIBRATION_RULES.peakPercentile))
}
