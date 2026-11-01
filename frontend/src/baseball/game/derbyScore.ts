import { calibrate, type Calibration, type PracticeSample, practiceTimingOffset } from './calibration'
import { DIFFICULTY_RULES, PRACTICE_PITCH_FLIGHT_SECONDS } from './difficulty'
import type { BattingSide } from './field'
import { judgeTiming, swingPower, timingErrorMs, type TimingId } from './judging'
import { type JudgedSwing, type Landing, landingFor, MISSED } from './landing'
import type { PitchPlan, PitchTypeId } from './pitch'
import { planRunPitch, runPitchFlightSeconds, type RunPlan } from './runPlan'

// The leaderboard seam: a run's plan and its raw input log score it, with nothing the client worked out in between.
// The live game scores each pitch with these same functions and shows the replayed result at the end, so the numbers
// on screen are the ones a server recomputing the run will get.

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

/**
 * How one pitch went. The pitch type is told only here, after the pitch. `timing` and `errorMs` (after the offset) are
 * null when the visitor let the pitch go by.
 */
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
  return summarizeDerby(plan, pitches)
}

/**
 * The practice (runPlan.ts createPracticePlan) judged again from its plan and log, as it played: each pitch at the
 * practice pace, against the visitor's usual timing up to it (practiceCalibration).
 */
export function replayPractice(plan: RunPlan, log: DerbyInputLog): DerbyResult {
  const pitches = plan.schedule.map((_, pitchIndex) =>
    scorePitch(plan, practiceCalibration(plan, log, pitchIndex), log, pitchIndex, PRACTICE_PITCH_FLIGHT_SECONDS),
  )
  return summarizeDerby(plan, pitches)
}

/**
 * What practice pitch `pitchIndex` is judged with: the visitor's usual timing in the practice's swings up to this one,
 * this one's included (calibration.ts practiceTimingOffset), and the speed peak of the practice before it, which has
 * none. The field and the word practice shows both come from that one judgement, and a steady webcam delay is no miss.
 */
export function practiceCalibration(plan: RunPlan, log: DerbyInputLog, pitchIndex: number): Calibration {
  const samples = log.swings
    .slice(0, pitchIndex + 1)
    .flatMap((swing, swingIndex) => (swing ? [practiceSample(plan, swingIndex, swing)] : []))
  return { ...calibrate(log.practice), offsetMs: practiceTimingOffset(samples) }
}

/**
 * What a practice swing at pitch `pitchIndex` leaves for the calibration of the runs after it: its raw timing error
 * against the contact point, before any offset, and its top speed.
 */
export function practiceSample(plan: RunPlan, pitchIndex: number, swing: SwingEvent): PracticeSample {
  const pitch = planRunPitch(plan, pitchIndex, PRACTICE_PITCH_FLIGHT_SECONDS)
  return { errorMs: timingErrorMs(pitch, swing.contactMs, 0), speed: swing.speed }
}

/**
 * Pitch `pitchIndex`, flying at `pitchFlightSeconds`, judged from the log's swing at it; `calibration` is a run's
 * `calibrate(log.practice)`, made once, or practice's for this pitch (practiceCalibration).
 */
export function scorePitch(
  plan: RunPlan,
  calibration: Calibration,
  log: DerbyInputLog,
  pitchIndex: number,
  pitchFlightSeconds = runPitchFlightSeconds(plan),
): PitchResult {
  const pitchType = plan.schedule[pitchIndex].type
  const swing = log.swings[pitchIndex] ?? null
  if (swing === null) return { ...MISSED, pitchType, timing: null, errorMs: null }
  const windows = DIFFICULTY_RULES[plan.rules.difficulty].timingWindows
  const pitch = planRunPitch(plan, pitchIndex, pitchFlightSeconds)
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

export function summarizeDerby(plan: RunPlan, pitches: PitchResult[]): DerbyResult {
  return { plan, pitches, ...homeRunTotals(pitches) }
}

/** The home runs among `pitches`, their summed distance, and the longest: what ranks a run, and what the HUD shows. */
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
