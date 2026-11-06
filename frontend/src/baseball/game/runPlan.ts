import type { BallparkRules } from '../../data/models'
import { DIFFICULTY_RULES } from './difficulty'
import { planPitch } from './pitch'
import { createPitchSchedule, PRACTICE_SCHEDULE, type ScheduledPitch } from './pitchSchedule'
import { createSeededRandom } from './seededRandom'

/**
 * One run, shaped like what a server will issue later: the rules in effect when it began (a snapshot, so the run keeps
 * them whatever changes afterwards) and the 32-bit unsigned seed its pitches are planned from. `schedule` follows from
 * the two, so a server replaying the run rebuilds it instead of trusting a client's.
 */
export type RunPlan = { seed: number; rules: BallparkRules; schedule: ScheduledPitch[] }

export function createRunPlan(rules: BallparkRules, seed: number): RunPlan {
  const unsignedSeed = seed >>> 0
  const schedule = createPitchSchedule(createSeededRandom(unsignedSeed), rules.pitchCount)
  return { seed: unsignedSeed, rules: { ...rules }, schedule }
}

/**
 * The practice before a run, shaped like one: the practice pitches in their fixed order under the run's `rules`, whose
 * timing windows judge it. It draws nothing at random, so its seed is 0, and it flies at the practice pace
 * (PRACTICE_PITCH_FLIGHT_SECONDS) rather than the difficulty's. It is never scored: only its swings' timing and speed
 * go into the log of the runs after it. More practice passes its shorter `schedule`.
 */
export function createPracticePlan(rules: BallparkRules, schedule = PRACTICE_SCHEDULE): RunPlan {
  return { seed: 0, rules: { ...rules, pitchCount: schedule.length }, schedule: [...schedule] }
}

/** A fastball's flight from release to the plate (s) in the run: its difficulty's. */
export function runPitchFlightSeconds(plan: RunPlan) {
  return DIFFICULTY_RULES[plan.rules.difficulty].pitchFlightSeconds
}

/**
 * The flight of the run's pitch `pitchIndex` at the pace `pitchFlightSeconds`: by default the run's own; only practice
 * passes another.
 */
export function planRunPitch(plan: RunPlan, pitchIndex: number, pitchFlightSeconds = runPitchFlightSeconds(plan)) {
  const { type, target } = plan.schedule[pitchIndex]
  return planPitch(type, pitchFlightSeconds, target)
}
