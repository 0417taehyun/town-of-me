import { effectiveBallparkRules, rankingMonth } from '../data/ballparkRules'
import type { BallparkSettings } from '../data/models'
import type { BattingSide } from './game/field'
import { createRunPlan } from './game/runPlan'
import type { RealTimeSwing, StageRunSetup } from './stage/stageRun'

// A run played with the keyboard (or the on-screen swing button): no practice to calibrate from, and a key press is
// the moment the bat meets the ball.

/** The visitor bats right-handed until the setup screen lets them choose. */
export const DEFAULT_BATTING_SIDE: BattingSide = 'right'

/**
 * A keyboard run under the rules `rulesFor` picks for the KST month of `now`: by default those in effect, or in an
 * admin's preview those planned next (data/ballparkRules.ts). Each run reads the month when it starts, so a page left
 * open into a new month plays the rules `ballpark` scheduled for it (as loaded with the page) from its next run.
 * Ranked runs will take their plan from the server instead.
 */
export function createKeyboardRun(
  ballpark: BallparkSettings,
  now: Date,
  seed: number,
  rulesFor = effectiveBallparkRules,
): StageRunSetup {
  const rules = rulesFor(ballpark, rankingMonth(now))
  return {
    plan: createRunPlan(rules, seed),
    log: { input: 'keyboard', side: DEFAULT_BATTING_SIDE, practice: [] },
  }
}

/** A fresh 32-bit seed for a run; ranked runs will get theirs from the server instead. */
export function randomRunSeed() {
  return crypto.getRandomValues(new Uint32Array(1))[0]
}

/** A key press or button press as a swing; `timeStamp` is the event's, on the performance.now() clock. */
export function keyboardSwing(timeStamp: number): RealTimeSwing {
  return { source: 'keyboard', contactAtRealMs: timeStamp, startedAtRealMs: timeStamp, speed: 0, heightError: null }
}

/**
 * Space or Enter swings, held keys repeat nothing, and a key pressed on a focused control keeps its own meaning there:
 * Enter on the back link still leaves, and Space on a language button still switches. Only the swing button swings.
 */
export function isSwingKey(event: Pick<KeyboardEvent, 'key' | 'repeat' | 'target'>) {
  if (event.key !== ' ' && event.key !== 'Enter') return false
  const control = 'a, button:not(.derby-swing), input, select, textarea'
  const ownsKey = event.target instanceof Element && event.target.closest(control) !== null
  return !event.repeat && !ownsKey
}
