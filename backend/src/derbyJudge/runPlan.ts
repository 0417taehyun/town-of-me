import type { BallparkRules } from '../town.js'
import { DIFFICULTY_RULES } from './difficulty.js'
import { itemAt } from './itemAt.js'
import { planPitch } from './pitch.js'
import { createPitchSchedule, type ScheduledPitch } from './pitchSchedule.js'
import { createSeededRandom } from './seededRandom.js'

// Mirrors frontend/src/baseball/game/runPlan.ts without the practice plan.

/**
 * One run: the rules in effect when it was issued (a snapshot, so the run keeps them whatever changes afterwards) and
 * the 32-bit unsigned seed its pitches are planned from. `schedule` follows from the two, so the server rebuilds it
 * instead of trusting a client's.
 */
export type RunPlan = { seed: number; rules: BallparkRules; schedule: ScheduledPitch[] }

export function createRunPlan(rules: BallparkRules, seed: number): RunPlan {
  const unsignedSeed = seed >>> 0
  const schedule = createPitchSchedule(createSeededRandom(unsignedSeed), rules.pitchCount)
  return { seed: unsignedSeed, rules: { ...rules }, schedule }
}

/** A fastball's flight from release to the plate (s) in the run: its difficulty's. */
export function runPitchFlightSeconds(plan: RunPlan) {
  return DIFFICULTY_RULES[plan.rules.difficulty].pitchFlightSeconds
}

/** The flight of the run's pitch `pitchIndex` at the run's pace. */
export function planRunPitch(plan: RunPlan, pitchIndex: number) {
  const { type, target } = itemAt(plan.schedule, pitchIndex)
  return planPitch(type, runPitchFlightSeconds(plan), target)
}
