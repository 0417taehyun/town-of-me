import type { BallparkDifficulty } from '../town.js'

// Mirrors frontend/src/baseball/game/difficulty.ts. Admins pick a difficulty by name only; the numbers live in code so
// a ranking month's rules judge the same everywhere.

/** How far (ms either side of the contact reference) a swing may be off to be PERFECT, GOOD, or to touch the ball. */
export type TimingWindows = { perfect: number; good: number; contact: number }

/** `pitchFlightSeconds` is a fastball's flight from release to the plate; slower types stretch it. */
export type DifficultyRule = { pitchFlightSeconds: number; timingWindows: TimingWindows }

export const DIFFICULTY_RULES = {
  easy: { pitchFlightSeconds: 1, timingWindows: { perfect: 50, good: 112, contact: 188 } },
  normal: { pitchFlightSeconds: 0.85, timingWindows: { perfect: 40, good: 90, contact: 150 } },
  hard: { pitchFlightSeconds: 0.68, timingWindows: { perfect: 32, good: 72, contact: 120 } },
} satisfies Record<BallparkDifficulty, DifficultyRule>
