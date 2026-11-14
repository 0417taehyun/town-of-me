import type { BaseballDifficulty } from '../../data/models'

/** How far (ms either side of the contact reference) a swing may be off to be PERFECT, GOOD, or to touch the ball. */
export type TimingWindows = { perfect: number; good: number; contact: number }

/** `pitchFlightSeconds` is a fastball's flight from release to the plate; slower types stretch it. */
export type DifficultyRule = { pitchFlightSeconds: number; timingWindows: TimingWindows }

// Admins pick a difficulty by name only. The numbers live in code so a ranking week's rules judge the same everywhere.
export const DIFFICULTY_RULES = {
  easy: { pitchFlightSeconds: 1, timingWindows: { perfect: 50, good: 112, contact: 188 } },
  normal: { pitchFlightSeconds: 0.85, timingWindows: { perfect: 40, good: 90, contact: 150 } },
  hard: { pitchFlightSeconds: 0.68, timingWindows: { perfect: 32, good: 72, contact: 120 } },
} satisfies Record<BaseballDifficulty, DifficultyRule>

/** Practice calibrates the visitor's timing and is not a rule, so its pace is the same at every difficulty. */
export const PRACTICE_PITCH_FLIGHT_SECONDS = 1.2
