import { effectiveBallparkRules, rankingMonth } from '../../data/ballparkRules'
import type { BallparkSettings, BaseballDifficulty } from '../../data/models'
import type { CameraStatus } from '../cameraTracking'
import { CALIBRATION_RULES, calibrate, isValidPracticeSwing, type PracticeSample } from '../game/calibration'
import { DIFFICULTY_RULES, type TimingWindows } from '../game/difficulty'
import type { DerbyInputLog, DerbyResult, PitchResult } from '../game/derbyScore'
import type { BattingSide } from '../game/field'
import { createPracticePlan, createRunPlan } from '../game/runPlan'
import type { StageEvent, StageRunSetup } from '../stage/stageRun'
import type { StanceWait } from './stanceHold'

// The derby's steps: the rules card, the camera's setup, practice, the step after it, the run, and its result. Only the
// first click is needed: it turns the camera on and asks for everything else a click must (BaseballApp.tsx). From there
// the visitor goes on by holding the batting stance (stanceHold.ts) or by the step's button, which Enter and Space
// press once it has focus, as any button. No key starts a step by itself or swings: only the camera sees swings.
// Practice pitches the game core's practice schedule at the practice pace, says how each swing was timed in words only,
// against the visitor's own usual timing, and calibrates every run after it until the camera turns off. Practice and
// a run pause between pitches while the visitor is out of the camera's view.

export type DerbyStep = 'rules' | 'setup' | 'practice' | 'practiceDone' | 'play' | 'result'

/**
 * Where the visitor is: the step they last went on to and when (performance.now() ms), the run the stage plays, the
 * practice swings so far (which calibrate every run after them), and a finished run's result. Which step is on screen
 * also depends on the camera (derbyStep).
 */
export type DerbyFlow = {
  step: DerbyStep
  since: number
  run: StageRunSetup | null
  practice: PracticeSample[]
  result: DerbyResult | null
}

export const RULES_FLOW: DerbyFlow = { step: 'rules', since: 0, run: null, practice: [], result: null }

/** The flow once the camera is turned on at `at`: its setup, with any earlier practice forgotten. */
export function setupFlow(at: number): DerbyFlow {
  return { ...RULES_FLOW, step: 'setup', since: at }
}

/** The steps that wait for the visitor to go on: by holding the stance, or by the step's button. */
export const WAITING_STEPS: readonly DerbyStep[] = ['setup', 'practiceDone', 'result']

/**
 * The step on screen: the rules card while the camera is off, and the setup until the camera is ready to play or
 * while it names a problem; otherwise the step the visitor last went on to.
 */
export function derbyStep(flow: DerbyFlow, camera: CameraStatus['kind']): DerbyStep {
  if (camera === 'off') return 'rules'
  if (camera !== 'ready' || flow.step === 'rules') return 'setup'
  return flow.step
}

/** The run the stage plays: the flow's while its step is on screen, so a camera that turns off takes the run along. */
export function shownRun(flow: DerbyFlow, step: DerbyStep) {
  return step === flow.step ? flow.run : null
}

/**
 * What the stance hold waits for: a key that is new for each step that waits, so a hold never carries over from one to
 * the next, and whether the step comes right after swings (all but the setup), where a stance kept from the last swing
 * must not count; null during practice and a run, where a stance is a swing about to come. The hold runs only while
 * the camera is ready (cameraTracking.ts).
 */
export function stanceWait(flow: DerbyFlow): StanceWait | null {
  if (!WAITING_STEPS.includes(flow.step)) return null
  return { key: `${flow.step}@${flow.since}`, afterSwings: flow.step !== 'setup' }
}

/** What a go can start: the practice, and a run calibrated by `practice`. */
export type DerbyPlays = { practice: () => StageRunSetup; run: (practice: PracticeSample[]) => StageRunSetup }

/**
 * The flow after the visitor's go at `at` (the held stance, or the step's button): practice from the setup, a run
 * after practice, and another after a result, both calibrated by the practice. Other steps take no go.
 */
export function startedFlow(flow: DerbyFlow, at: number, plays: DerbyPlays): DerbyFlow {
  if (flow.step === 'setup') return { ...flow, step: 'practice', since: at, run: plays.practice(), practice: [] }
  if (flow.step !== 'practiceDone' && flow.step !== 'result') return flow
  return { ...flow, step: 'play', since: at, run: plays.run(flow.practice), result: null }
}

/**
 * The flow after a stage event at `at`: practice keeps each swing's timing and speed, and ends in the step that waits
 * for the run; a run ends in its result.
 */
export function flowAfterEvent(flow: DerbyFlow, event: StageEvent, at: number): DerbyFlow {
  if (event.type === 'finished') return finishedFlow(flow, event.result, at)
  const sample = flow.step === 'practice' && event.type === 'result' ? practiceSample(event) : null
  return sample ? { ...flow, practice: [...flow.practice, sample] } : flow
}

/**
 * What a practice pitch's result leaves for the calibration, or null for a pitch let go by: the swing's timing error as
 * practice judged it, which is with no calibration and so against the contact point itself, and its top speed.
 */
export function practiceSample({ result, swing }: Extract<StageEvent, { type: 'result' }>): PracticeSample | null {
  return swing && result.errorMs !== null ? { errorMs: result.errorMs, speed: swing.speed } : null
}

export function finishedFlow(flow: DerbyFlow, result: DerbyResult, at: number): DerbyFlow {
  if (flow.step === 'practice') return { ...flow, step: 'practiceDone', since: at, run: null }
  return flow.step === 'play' ? { ...flow, step: 'result', since: at, result } : flow
}

/** All a practice swing is told: a bit early, good, or a bit late. */
export type PracticeFeedback = 'early' | 'good' | 'late'

/**
 * The word for a practice swing's timing error once the visitor's usual timing is taken off it (ms, minus = early):
 * good within the difficulty's GOOD window, else the way it missed.
 */
export function practiceFeedback(errorMs: number, windows: TimingWindows): PracticeFeedback {
  if (Math.abs(errorMs) <= windows.good) return 'good'
  return errorMs < 0 ? 'early' : 'late'
}

/**
 * The word practice shows for the `judged` pitch's result (from when it is judged until the next windup, derbyCues.ts
 * judgedResult), told against the visitor's own usual timing, as a run's judge tells it. Practice measures the error
 * against the contact point itself; the word takes off it the offset the run's calibration finds in `practice`, the
 * swings so far with this one included (flowAfterEvent keeps it as it is judged): the median of the valid ones, from
 * the third on. Against the contact point alone a webcam's steady delay would call nearly every swing late, and a
 * visitor who swung earlier for it would then be judged early in the run. Before the third valid swing there is no
 * usual timing yet, so a valid swing is good, and one too far off to count says which way it missed. Null while no
 * result shows, and for a pitch let go by, which has its own line.
 */
export function shownPracticeFeedback(
  judged: PitchResult | null,
  difficulty: BaseballDifficulty,
  practice: readonly PracticeSample[],
): PracticeFeedback | null {
  const errorMs = judged?.errorMs ?? null
  if (errorMs === null) return null
  const learning = practice.filter(isValidPracticeSwing).length < CALIBRATION_RULES.minimumValidSwings
  if (learning && isValidPracticeSwing({ errorMs })) return 'good'
  return practiceFeedback(errorMs - calibrate(practice).offsetMs, DIFFICULTY_RULES[difficulty].timingWindows)
}

/**
 * Practice and a run stand still for a visitor out of the camera's view (`present` false), but only
 * `betweenPitches` (derbyCues.ts): a pitch on its way and its result play out, so no ball stops in the air and a run
 * still finishes, and a swing made while it stands still meets no pitch. Once the visitor is back, the next pitch comes
 * with a fresh windup. No other step stands still.
 */
export function pausedForAway(step: DerbyStep, present: boolean, betweenPitches: boolean) {
  return !present && betweenPitches && (step === 'practice' || step === 'play')
}

/** The visitor bats right-handed until they choose otherwise on the setup card. */
export const DEFAULT_BATTING_SIDE: BattingSide = 'right'

/**
 * A run played as `log` says under the rules `rulesFor` picks for the KST month of `now`: by default those in effect,
 * or in an admin's preview those planned next (data/ballparkRules.ts). Each run reads the month when it starts, so a
 * page left open into a new month plays the rules `ballpark` scheduled for it (as loaded with the page) from its next
 * run. Ranked runs will take their plan from the server instead.
 */
export function createDerbyRun(
  ballpark: BallparkSettings,
  now: Date,
  seed: number,
  log: Omit<DerbyInputLog, 'swings'>,
  rulesFor = effectiveBallparkRules,
): StageRunSetup {
  return { plan: createRunPlan(rulesFor(ballpark, rankingMonth(now)), seed), log }
}

/**
 * The practice before a run at `now`, batting on `side`: the practice pitches at the practice pace, judged by
 * the timing windows of the rules a run would play then, with no calibration, since it measures one.
 */
export function createPracticeRun(
  ballpark: BallparkSettings,
  now: Date,
  side: BattingSide,
  rulesFor = effectiveBallparkRules,
): StageRunSetup {
  return {
    plan: createPracticePlan(rulesFor(ballpark, rankingMonth(now))),
    log: { side, practice: [] },
    practice: true,
  }
}

/** A fresh 32-bit seed for a run; ranked runs will get theirs from the server instead. */
export function randomRunSeed() {
  return crypto.getRandomValues(new Uint32Array(1))[0]
}
