import { calibrate, CALIBRATION_RULES, isValidPracticeSwing, type Calibration } from './derbyJudge/calibration.js'
import { replayDerby, type DerbyInputLog, type PitchResult, type SwingEvent } from './derbyJudge/derbyScore.js'
import { swingPower } from './derbyJudge/judging.js'
import { LONGEST_CARRY, type Outcome, toDecimetres } from './derbyJudge/landing.js'
import type { PitchTypeId } from './derbyJudge/pitch.js'
import { createRunPlan } from './derbyJudge/runPlan.js'
import { median } from './derbyJudge/statistics.js'
import { DomainError } from './domain.js'
import type { BallparkRules } from './town.js'
import {
  boundedInteger,
  boundedNumber,
  inputList,
  inputRecord,
  invalidInput,
  oneOf,
  optionalInput,
} from './validation.js'

// The home run derby as a ranked game: what a run's result must hold, how the server scores it with the ported judge
// (derbyJudge/), and which runs are held for the admin to look at. The client sends no score anyone keeps: only its
// batting side, its practice numbers, and four numbers per pitch, never pose keypoints or motion.

/** The one ranked game: the derby at the ballpark of the town the site serves. */
export const homeRunDerby = {
  id: 'home-run-derby',
} as const

/** The farthest a home run can carry (dm): a dead-on swing at full power with the bat level with the ball. */
export const maximumHomeRunDecimetres = toDecimetres(LONGEST_CARRY)

// Mirrors frontend/src/baseball/game/pitchSchedule.ts PRACTICE_SCHEDULE: practice leaves one sample per pitch at most.
const practiceSampleLimit = 5
const battingSides = ['right', 'left'] as const
// Mirrors frontend/src/baseball/game/derby.ts DERBY_PHASE_MS and RESULT_HOLD_MS.miss: every pitch has its ready and
// windup phases and at least a miss's result hold, and game time never runs ahead of the real clock (gameClock.ts).
const shortestPitchMs = 800 + 900 + 1500
// The share of that floor a run must last on the server's clock. The rest absorbs the network: the run is timed from
// the moment it is issued, before the response reaches the browser that plays it.
const minimumRunShare = 0.85

/**
 * What the server checks a run against (initial values, published like the judge): a held run is stored but stays off
 * the board until an admin accepts it. They only make cheap cheating cost more; none relies on being secret.
 */
export const DERBY_REVIEW_RULES = {
  /** Three or more swings all this close (ms) to dead-on. */
  preciseTimingMs: 5,
  /** This many swings with the same error to a tenth of a millisecond. */
  repeatedErrors: 3,
  /** A webcam always lags, so a practice median outside this range (ms, before the offset clamp) is unusual. */
  practiceMedian: { minimum: 30, maximum: 300 },
  /** A run swing this many times faster than the practice peak. */
  practiceSpeedRatio: 1.5,
  /** The checks on contact need at least this many balls the bat met. */
  minimumContacts: 3,
  /** From the swing's start to its contact (ms): under two camera frames, or longer than the tracker waits. */
  swingDuration: { minimum: 50, maximum: 450 },
  /** Shoulder widths per second; real swings stay far below it. */
  maximumSwingSpeed: 40,
  /** Webcam speeds wobble, so every contact at high power, or powers this steady, is unusual. */
  steadyPower: { minimum: 1.1, variation: 0.02 },
  /** Home run distance this close to the most the rules allow. */
  nearMaximumShare: 0.9,
  /** A client clock that claims this much longer (ms) than the server measured. */
  clockSkewMs: 2000,
}

/** What a run's result says beyond the log: the client's own totals, which only decide whether the run is held. */
export interface DerbySubmission {
  log: DerbyInputLog
  clientElapsedMs: number
  claimed: { homeRuns: number; totalDistanceDm: number }
}

/** How the server judged a run, kept with it for review. */
export interface DerbyRunRecord {
  pitches: PitchResult[]
  homeRuns: number
  homeRunDistanceDecimetres: number
  longestHomeRunDecimetres: number
  calibration: Calibration
  /** The valid practice swings' median error before `calibrate` clamps it into the offset range. */
  practiceMedianMs: number
  claimed: DerbySubmission['claimed']
  clientElapsedMs: number
  serverElapsedMs: number
}

/** What visitors see of a run: per pitch only its type, outcome, and distance, never a timing verdict or power. */
export interface PublicDerbyResult {
  homeRuns: number
  /** The home runs' summed distance, the tiebreak. */
  totalDistanceDm: number
  pitches: Array<{ pitchType: PitchTypeId; outcome: Outcome; distanceDm: number | null }>
}

/** Everything a ranked check reads. */
export interface DerbyRunReview {
  rules: BallparkRules
  log: DerbyInputLog
  record: DerbyRunRecord
}

/** An unknown game is reported like an unknown route. */
export function assertRankedGame(game: string): void {
  if (game !== homeRunDerby.id) throw new DomainError('NOT_FOUND', 'Game not found')
}

/** The shortest a run of `rules` can honestly take on the server's clock (ms). */
export function minimumRunMs(rules: BallparkRules): number {
  return minimumRunShare * rules.pitchCount * shortestPitchMs
}

/**
 * Reads only the listed fields, so anything else in the body (pose keypoints, traces, a client's rules or seed) is
 * dropped before it can be stored. `rules` are the run's own, so the swings must match its pitch count.
 */
export function parseDerbySubmission(input: Record<string, unknown>, rules: BallparkRules): DerbySubmission {
  const practice = inputList(input.practice, 'practice', practiceSampleLimit).map((sample, index) =>
    parsePracticeSample(sample, `practice[${index}]`),
  )
  if (practice.filter(isValidPracticeSwing).length < CALIBRATION_RULES.minimumValidSwings) {
    throw invalidInput(
      `a ranked run needs ${CALIBRATION_RULES.minimumValidSwings} practice swings within ${CALIBRATION_RULES.validErrorMs} ms`,
    )
  }
  const swings = inputList(input.swings, 'swings', rules.pitchCount, rules.pitchCount).map((swing, index) =>
    optionalInput(swing, (present) => parseSwingEvent(present, `swings[${index}]`)),
  )
  return {
    log: { side: oneOf(input.side, battingSides, 'side'), practice, swings },
    clientElapsedMs: boundedNumber(input.clientElapsedMs, 'clientElapsedMs', 0, 600_000),
    claimed: parseClaimedTotals(input.claimed, rules),
  }
}

/** A practice swing's error is before any offset, so a late webcam's report can be far off; the judge ignores those. */
export function parsePracticeSample(value: unknown, field: string) {
  const input = inputRecord(value, field)
  return {
    errorMs: boundedNumber(input.errorMs, `${field}.errorMs`, -5000, 5000),
    speed: boundedNumber(input.speed, `${field}.speed`, 0, 200),
  }
}

/** Times are from the pitch's release (ms); a swing starts before its contact, perhaps before the release. */
export function parseSwingEvent(value: unknown, field: string): SwingEvent {
  const input = inputRecord(value, field)
  const contactMs = boundedNumber(input.contactMs, `${field}.contactMs`, 0, 5000)
  return {
    contactMs,
    startedMs: boundedNumber(input.startedMs, `${field}.startedMs`, -1000, contactMs),
    speed: boundedNumber(input.speed, `${field}.speed`, 0, 200),
    heightError: optionalInput(input.heightError, (height) => boundedNumber(height, `${field}.heightError`, -3, 3)),
  }
}

export function parseClaimedTotals(value: unknown, rules: BallparkRules): DerbySubmission['claimed'] {
  const input = inputRecord(value, 'claimed')
  return {
    homeRuns: boundedInteger(input.homeRuns, 'claimed.homeRuns', 0, rules.pitchCount),
    totalDistanceDm: boundedInteger(
      input.totalDistanceDm,
      'claimed.totalDistanceDm',
      0,
      rules.pitchCount * maximumHomeRunDecimetres,
    ),
  }
}

/** The run judged again from the plan its rules and seed give and the raw log, whatever the client worked out. */
export function judgeDerbyRun(
  rules: BallparkRules,
  seed: number,
  submission: DerbySubmission,
  serverElapsedMs: number,
): DerbyRunRecord {
  const replay = replayDerby(createRunPlan(rules, seed), submission.log)
  const validPractice = submission.log.practice.filter(isValidPracticeSwing)
  return {
    pitches: replay.pitches,
    homeRuns: replay.homeRuns,
    homeRunDistanceDecimetres: replay.homeRunDistanceDecimetres,
    longestHomeRunDecimetres: replay.longestHomeRunDecimetres,
    calibration: calibrate(submission.log.practice),
    practiceMedianMs: median(validPractice.map((sample) => sample.errorMs)),
    claimed: submission.claimed,
    clientElapsedMs: submission.clientElapsedMs,
    serverElapsedMs,
  }
}

export function publicDerbyResult(record: DerbyRunRecord): PublicDerbyResult {
  return {
    homeRuns: record.homeRuns,
    totalDistanceDm: record.homeRunDistanceDecimetres,
    pitches: record.pitches.map(({ pitchType, outcome, distanceDecimetres }) => ({
      pitchType,
      outcome,
      distanceDm: outcome === 'miss' ? null : distanceDecimetres,
    })),
  }
}

/** Each review flag and when it holds; a run with any is held. */
export const derbyRunChecks: ReadonlyArray<readonly [string, (review: DerbyRunReview) => boolean]> = [
  ['claimed-mismatch', claimsOtherTotals],
  ['timing-too-precise', timesTooPrecisely],
  ['machine-values', repeatsMachineValues],
  ['calibration-offset', hasUnusualPracticeMedian],
  ['peak-at-floor', hasPeakAtFloor],
  ['speed-outside-practice', outpacesPractice],
  ['height-missing', missesEveryHeight],
  ['swing-duration', hasImplausibleSwingDuration],
  ['swing-speed', hasImplausibleSwingSpeed],
  ['steady-power', hasSteadyPower],
  ['near-maximum', nearsMaximumDistance],
  ['clock-skew', claimsLongerThanMeasured],
]

export function derbyRunFlags(review: DerbyRunReview): string[] {
  return derbyRunChecks.filter(([, holds]) => holds(review)).map(([flag]) => flag)
}

/** The client's replay should give exactly the server's totals: same code, same arithmetic. */
export function claimsOtherTotals({ record }: DerbyRunReview) {
  return (
    record.claimed.homeRuns !== record.homeRuns || record.claimed.totalDistanceDm !== record.homeRunDistanceDecimetres
  )
}

export function timesTooPrecisely(review: DerbyRunReview) {
  const errors = swingErrors(review)
  return (
    errors.length >= DERBY_REVIEW_RULES.repeatedErrors &&
    errors.every((errorMs) => Math.abs(errorMs) <= DERBY_REVIEW_RULES.preciseTimingMs)
  )
}

export function repeatsMachineValues(review: DerbyRunReview) {
  const errors = swingErrors(review)
  const allZero = errors.length > 0 && errors.every((errorMs) => errorMs === 0)
  return allZero || largestRepeat(errors) >= DERBY_REVIEW_RULES.repeatedErrors
}

export function hasUnusualPracticeMedian({ record }: DerbyRunReview) {
  const { minimum, maximum } = DERBY_REVIEW_RULES.practiceMedian
  return record.practiceMedianMs < minimum || record.practiceMedianMs > maximum
}

/** A made-up slow practice would make ordinary swings full power. */
export function hasPeakAtFloor({ record }: DerbyRunReview) {
  return record.calibration.peakSpeed <= CALIBRATION_RULES.peakFloor
}

export function outpacesPractice(review: DerbyRunReview) {
  const fastest = review.record.calibration.peakSpeed * DERBY_REVIEW_RULES.practiceSpeedRatio
  return swingsTaken(review).some((swing) => swing.speed > fastest)
}

/** Claiming the bat was lost never pays more than measuring it, but every contact unmeasured is a signal. */
export function missesEveryHeight(review: DerbyRunReview) {
  const contacts = contactSwings(review)
  return contacts.length >= DERBY_REVIEW_RULES.minimumContacts && contacts.every((swing) => swing.heightError === null)
}

export function hasImplausibleSwingDuration(review: DerbyRunReview) {
  const { minimum, maximum } = DERBY_REVIEW_RULES.swingDuration
  return swingsTaken(review).some((swing) => {
    const durationMs = swing.contactMs - swing.startedMs
    return durationMs < minimum || durationMs > maximum
  })
}

export function hasImplausibleSwingSpeed(review: DerbyRunReview) {
  return swingsTaken(review).some((swing) => swing.speed > DERBY_REVIEW_RULES.maximumSwingSpeed)
}

export function hasSteadyPower(review: DerbyRunReview) {
  const powers = contactSwings(review).map((swing) => swingPower(swing.speed, review.record.calibration.peakSpeed))
  const { minimum, variation } = DERBY_REVIEW_RULES.steadyPower
  if (powers.length < DERBY_REVIEW_RULES.minimumContacts) return false
  return powers.every((power) => power >= minimum) || coefficientOfVariation(powers) < variation
}

export function nearsMaximumDistance({ rules, record }: DerbyRunReview) {
  const ceiling = rules.pitchCount * maximumHomeRunDecimetres
  return record.homeRunDistanceDecimetres >= DERBY_REVIEW_RULES.nearMaximumShare * ceiling
}

export function claimsLongerThanMeasured({ record }: DerbyRunReview) {
  return record.clientElapsedMs > record.serverElapsedMs + DERBY_REVIEW_RULES.clockSkewMs
}

/** The server's timing error (after the offset) of every pitch the visitor swung at. */
export function swingErrors({ record }: DerbyRunReview): number[] {
  return record.pitches.map((pitch) => pitch.errorMs).filter((errorMs) => errorMs !== null)
}

export function swingsTaken({ log }: DerbyRunReview): SwingEvent[] {
  return log.swings.filter((swing) => swing !== null)
}

/** The swings whose bat met the ball: a home run, a hit, or a foul. */
export function contactSwings({ log, record }: DerbyRunReview): SwingEvent[] {
  return log.swings.filter(
    (swing, index): swing is SwingEvent => swing !== null && record.pitches[index]?.outcome !== 'miss',
  )
}

/** How many of `values` share one value to a tenth of a millisecond. */
export function largestRepeat(values: readonly number[]): number {
  const counts = new Map<number, number>()
  values.forEach((value) => counts.set(Math.round(value * 10), (counts.get(Math.round(value * 10)) ?? 0) + 1))
  return Math.max(0, ...counts.values())
}

/** The population standard deviation over the mean, of positive values. */
export function coefficientOfVariation(values: readonly number[]): number {
  const mean = values.reduce((total, value) => total + value, 0) / values.length
  const variance = values.reduce((total, value) => total + (value - mean) ** 2, 0) / values.length
  return Math.sqrt(variance) / mean
}
