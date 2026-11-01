import { calibrate, type Calibration, type PracticeSample } from './calibration'
import { DIFFICULTY_RULES } from './difficulty'
import type { BattingSide } from './field'
import { judgeTiming, KEYBOARD_POWER, swingPower, timingErrorMs, type TimingId } from './judging'
import { type JudgedSwing, type Landing, landingFor, MISSED } from './landing'
import type { PitchPlan, PitchTypeId } from './pitch'
import { planRunPitch, runPitchFlightSeconds, type RunPlan } from './runPlan'

// The leaderboard seam: a run's plan and its raw input log score it, with nothing the client worked out in between.
// The live game scores each pitch with these same functions and shows the replayed result at the end, so the numbers
// on screen are the ones a server recomputing the run will get.

/**
 * A key press measures no speed or bat height, so a keyboard swing is judged at a fixed power with the bat level with
 * the ball; its run is never ranked.
 */
export type DerbyInput = 'camera' | 'keyboard'

/**
 * A swing at one pitch in the tracker's raw units, timed from that pitch's release (ms): what made it, when the bat
 * reached the contact point and when the swing began, its top speed (shoulder widths per second), and the bat's height
 * against the ball at the contact point (m, plus = above it) or null when nothing measured it. A key pressed during a
 * camera run is a keyboard swing, so it can never claim a camera's speed.
 */
export type SwingEvent = {
  source: DerbyInput
  contactMs: number
  startedMs: number
  speed: number
  heightError: number | null
}

/**
 * Everything the visitor did in a run: how they played it, their practice swings, and, for each pitch in order, a
 * swing or null. Every swing in a keyboard run counts as a keyboard swing.
 */
export type DerbyInputLog = {
  input: DerbyInput
  side: BattingSide
  practice: PracticeSample[]
  swings: (SwingEvent | null)[]
}

/**
 * How one pitch went. The pitch type is told only here, after the pitch. `timing`, `errorMs` (after the offset), and
 * `power` are null when the visitor let the pitch go by.
 */
export type PitchResult = Landing & {
  pitchType: PitchTypeId
  timing: TimingId | null
  errorMs: number | null
  power: number | null
}

/** A run ranks by its home runs, then by their summed distance; its input is keyboard if any swing in it was. */
export type DerbyResult = {
  plan: RunPlan
  input: DerbyInput
  pitches: PitchResult[]
  homeRuns: number
  homeRunDistanceDecimetres: number
  longestHomeRunDecimetres: number
}

/**
 * The whole run judged again from its plan and raw log, starting with the calibration. Every pitch flies at
 * `pitchFlightSeconds`, the run's own pace unless it is the practice (runPlan.ts createPracticePlan).
 */
export function replayDerby(
  plan: RunPlan,
  log: DerbyInputLog,
  pitchFlightSeconds = runPitchFlightSeconds(plan),
): DerbyResult {
  const calibration = calibrate(log.practice)
  const pitches = plan.schedule.map((_, pitchIndex) =>
    scorePitch(plan, calibration, log, pitchIndex, pitchFlightSeconds),
  )
  return summarizeDerby(plan, runInput(log), pitches)
}

export function runInput(log: DerbyInputLog): DerbyInput {
  const keyed = log.input === 'keyboard' || log.swings.some((swing) => swing?.source === 'keyboard')
  return keyed ? 'keyboard' : 'camera'
}

/**
 * Pitch `pitchIndex`, flying at `pitchFlightSeconds`, judged from the log's swing at it; `calibration` is
 * `calibrate(log.practice)`, made once.
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
  if (swing === null) return { ...MISSED, pitchType, timing: null, errorMs: null, power: null }
  const windows = DIFFICULTY_RULES[plan.rules.difficulty].timingWindows
  const pitch = planRunPitch(plan, pitchIndex, pitchFlightSeconds)
  const judged = toJudgedSwing(pitch, calibration, log.input, swing)
  const landing = landingFor(judged, windows, log.side)
  return {
    ...landing,
    pitchType,
    timing: judgeTiming(judged.errorMs, windows),
    errorMs: judged.errorMs,
    power: judged.power,
  }
}

/**
 * A raw swing at `pitch` as the judge sees it. A keyboard swing hits at a fixed power with the bat level with the
 * ball, so a key timed like the plan carries like it; only a camera swing whose tracking lost the bat is judged at the
 * unknown height.
 */
export function toJudgedSwing(
  pitch: PitchPlan,
  calibration: Calibration,
  input: DerbyInput,
  swing: SwingEvent,
): JudgedSwing {
  const errorMs = timingErrorMs(pitch, swing.contactMs, calibration.offsetMs)
  if (input === 'keyboard' || swing.source === 'keyboard') return { errorMs, power: KEYBOARD_POWER, heightError: 0 }
  return { errorMs, power: swingPower(swing.speed, calibration.peakSpeed), heightError: swing.heightError }
}

export function summarizeDerby(plan: RunPlan, input: DerbyInput, pitches: PitchResult[]): DerbyResult {
  return { plan, input, pitches, ...homeRunTotals(pitches) }
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
