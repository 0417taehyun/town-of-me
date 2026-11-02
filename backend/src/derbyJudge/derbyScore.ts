import { calibrate, type Calibration, type PracticeSample } from './calibration.js'
import { DIFFICULTY_RULES } from './difficulty.js'
import type { BattingSide } from './field.js'
import { itemAt } from './itemAt.js'
import { judgeTiming, swingPower, timingErrorMs, type TimingId } from './judging.js'
import { type JudgedSwing, type Landing, landingFor, MISSED } from './landing.js'
import type { PitchPlan, PitchTypeId } from './pitch.js'
import { planRunPitch, type RunPlan } from './runPlan.js'

// Mirrors frontend/src/baseball/game/derbyScore.ts: the server scores a run again from the plan it issued and the
// client's raw input log, trusting nothing the client worked out in between. The files in this folder keep the
// frontend judge's values and the order of every operation: reordering a sum or premultiplying constants can change
// the last bit of a double, which can flip a window comparison or Math.round. Golden vectors scored by the frontend
// (test/derbyJudgeVectors.json) hold both to the same results. The live derby, practice, and the drawn flight stay in
// the frontend.

/**
 * A camera swing at one pitch in the tracker's raw units, timed from that pitch's release (ms): when the bat reached
 * the contact point and when the swing began, its top speed (shoulder widths per second), and the bat's height against
 * the ball at the contact point (m, plus = above it) or null when the tracking lost the bat.
 */
export type SwingEvent = {
  contactMs: number
  startedMs: number
  speed: number
  heightError: number | null
}

/** Everything the visitor did in a run: their batting side, their practice swings, and a swing or null per pitch. */
export type DerbyInputLog = {
  side: BattingSide
  practice: PracticeSample[]
  swings: (SwingEvent | null)[]
}

/** How one pitch went. `timing` and `errorMs` (after the offset) are null when the visitor let the pitch go by. */
export type PitchResult = Landing & {
  pitchType: PitchTypeId
  timing: TimingId | null
  errorMs: number | null
}

/** A run ranks by its home runs, then by their summed distance. */
export type DerbyResult = {
  plan: RunPlan
  pitches: PitchResult[]
  homeRuns: number
  homeRunDistanceDecimetres: number
  longestHomeRunDecimetres: number
}

/** The whole run judged again from its plan and raw log, starting with the calibration, at the run's own pace. */
export function replayDerby(plan: RunPlan, log: DerbyInputLog): DerbyResult {
  const calibration = calibrate(log.practice)
  const pitches = plan.schedule.map((_, pitchIndex) => scorePitch(plan, calibration, log, pitchIndex))
  return { plan, pitches, ...homeRunTotals(pitches) }
}

/** Pitch `pitchIndex` judged from the log's swing at it; `calibration` is the run's `calibrate(log.practice)`. */
export function scorePitch(
  plan: RunPlan,
  calibration: Calibration,
  log: DerbyInputLog,
  pitchIndex: number,
): PitchResult {
  const pitchType = itemAt(plan.schedule, pitchIndex).type
  const swing = log.swings[pitchIndex] ?? null
  if (swing === null) return { ...MISSED, pitchType, timing: null, errorMs: null }
  const windows = DIFFICULTY_RULES[plan.rules.difficulty].timingWindows
  const pitch = planRunPitch(plan, pitchIndex)
  const judged = toJudgedSwing(pitch, calibration, swing)
  const landing = landingFor(judged, windows, log.side)
  return { ...landing, pitchType, timing: judgeTiming(judged.errorMs, windows), errorMs: judged.errorMs }
}

/**
 * A raw swing at `pitch` as the judge sees it: its timing error after the calibrated offset, its speed against the
 * practice peak, and its bat height, unknown when the tracking lost the bat (landing.ts HEIGHT_RULES).
 */
export function toJudgedSwing(pitch: PitchPlan, calibration: Calibration, swing: SwingEvent): JudgedSwing {
  const errorMs = timingErrorMs(pitch, swing.contactMs, calibration.offsetMs)
  return { errorMs, power: swingPower(swing.speed, calibration.peakSpeed), heightError: swing.heightError }
}

/** The home runs among `pitches`, their summed distance, and the longest: what ranks a run. */
export function homeRunTotals(pitches: readonly PitchResult[]) {
  const homeRunDistances = pitches
    .filter((pitch) => pitch.outcome === 'homeRun')
    .map((pitch) => pitch.distanceDecimetres)
  return {
    homeRuns: homeRunDistances.length,
    homeRunDistanceDecimetres: homeRunDistances.reduce((total, distance) => total + distance, 0),
    longestHomeRunDecimetres: Math.max(0, ...homeRunDistances),
  }
}
