import type { BallparkRules } from '../../data/models'
import { DIFFICULTY_RULES } from './difficulty'
import { type PitchPlan, planPitch } from './pitch'
import { createPitchSchedule, type ScheduledPitch } from './pitchSchedule'
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

/** The flight of the run's pitch `pitchIndex`, at the pace of the run's difficulty. */
export function planRunPitch(plan: RunPlan, pitchIndex: number): PitchPlan {
  const { type, target } = plan.schedule[pitchIndex]
  return planPitch(type, DIFFICULTY_RULES[plan.rules.difficulty].pitchFlightSeconds, target)
}
