import { calibrate, type Calibration, CALIBRATION_RULES } from './calibration'
import { DIFFICULTY_RULES, PRACTICE_PITCH_FLIGHT_SECONDS } from './difficulty'
import {
  type DerbyInput,
  type DerbyInputLog,
  type DerbyResult,
  type PitchResult,
  replayDerby,
  scorePitch,
  type SwingEvent,
} from './derbyScore'
import { contactHeight, contactSeconds, type PitchPlan } from './pitch'
import { planRunPitch, runPitchFlightSeconds, type RunPlan } from './runPlan'

// A run as it plays, on the game clock (ms, gameClock.ts). Each pitch goes ready → windup → pitch → result, then the
// next one; the run finishes after its last result. Every phase ends at a time worked out from when it began, never
// from when a frame happened to look, so the same swings give the same run at any frame rate. The stage draws from
// the events and never decides an outcome itself.

export type DerbyPhase = 'ready' | 'windup' | 'pitch' | 'result' | 'finished'

/** The game ms a pitch's ready and windup phases last; the ball leaves the hand when the windup ends. */
export const DERBY_PHASE_MS = { ready: 800, windup: 900 }

/** How long a result holds before the next pitch (ms): a home run gets its chase, a miss only a beat. */
export const RESULT_HOLD_MS: Record<PitchResult['outcome'], number> = {
  homeRun: 4000,
  hit: 2200,
  foul: 1800,
  miss: 1500,
}

/**
 * How long a pitch waits past the latest contact that still touches the ball, for a camera swing reported late, so
 * a slow camera or computer never loses a swing that touched the ball: as long as the camera's latest report (the
 * tracker confirms a swing up to 150 ms after its contact, `finishWithinMs` in vision/swingTracker.ts, on a frame up
 * to 67 ms later at 15 fps, which takes up to 100 ms to be delivered, tracked, and taken by the next drawn frame).
 * stageRun.test.ts holds the two together.
 */
export const LATE_SWING_MARGIN_MS = 320

/**
 * `log` holds a swing (or null) for each pitch finished so far and `results` their results. `phaseStartedMs` is when
 * the phase began; in the pitch phase that is the release. Its pitches fly at `pitchFlightSeconds`, a fastball's flight
 * (s), and it takes a swing up to `lateLimitMs` past the contact reference (contactReferenceMs): a run's own pace and
 * the latest swing that touches the ball, or the practice's (createDerby).
 */
export type Derby = {
  plan: RunPlan
  pitchFlightSeconds: number
  lateLimitMs: number
  calibration: Calibration
  log: DerbyInputLog
  results: PitchResult[]
  pitchIndex: number
  phase: DerbyPhase
  phaseStartedMs: number
}

export type DerbyEvent =
  | { type: 'windup'; pitchIndex: number }
  | { type: 'release'; pitchIndex: number; pitch: PitchPlan; releasedMs: number }
  | { type: 'result'; pitchIndex: number; result: PitchResult; swing: SwingEvent | null }
  | { type: 'finished'; result: DerbyResult }

export type DerbyUpdate = { derby: Derby; events: DerbyEvent[] }

/**
 * A swing on the game clock: what made it, when the bat reached the contact point and when the swing began, its top
 * speed (see SwingEvent), and how high the bat was there (field m), or null when nothing measured it. The derby logs
 * that height against the ball's at the contact point, since only it knows which pitch the swing met.
 */
export type DerbySwing = {
  source: DerbyInput
  contactAtMs: number
  startedAtMs: number
  speed: number
  batHeight: number | null
}

/**
 * A run starting at `nowMs`, judged with the calibration from the practice already in `log`. The `practice` before a
 * camera run flies at the practice pace, and takes a swing as late as the calibration still counts one, past the
 * contact window, so a slow camera's late swings still teach it; a run flies at its difficulty's pace and takes a swing
 * only while it can still touch the ball.
 */
export function createDerby(plan: RunPlan, log: Omit<DerbyInputLog, 'swings'>, nowMs: number, practice = false): Derby {
  const contactWindowMs = DIFFICULTY_RULES[plan.rules.difficulty].timingWindows.contact
  return {
    plan,
    pitchFlightSeconds: practice ? PRACTICE_PITCH_FLIGHT_SECONDS : runPitchFlightSeconds(plan),
    lateLimitMs: practice ? Math.max(contactWindowMs, CALIBRATION_RULES.validErrorMs) : contactWindowMs,
    calibration: calibrate(log.practice),
    log: { ...log, swings: [] },
    results: [],
    pitchIndex: 0,
    phase: 'ready',
    phaseStartedMs: nowMs,
  }
}

/** Every phase change due by `nowMs`, in order, however long it has been since the last call. */
export function advanceDerby(derby: Derby, nowMs: number): DerbyUpdate {
  const events: DerbyEvent[] = []
  let current = derby
  let next = nextDerbyStep(current, nowMs)
  while (next) {
    current = next.derby
    events.push(...next.events)
    next = nextDerbyStep(current, nowMs)
  }
  return { derby: current, events }
}

/**
 * A swing counts only if the ball is on its way when the bat gets there: one during the windup, or after the pitch has
 * ended, is ignored, and so is a second one. The run is first brought up to the swing's moment, so a swing reported a
 * frame late still meets the pitch it was aimed at; hand swings over before advancing past them. A swing carrying a
 * number that is not finite (a tracker glitch) is ignored too, so one bad sample cannot play out the rest of the run.
 */
export function swingDerby(derby: Derby, swing: DerbySwing): DerbyUpdate {
  if (!isFiniteSwing(swing)) return { derby, events: [] }
  const advanced = advanceDerby(derby, swing.contactAtMs)
  const releasedMs = advanced.derby.phaseStartedMs
  if (advanced.derby.phase !== 'pitch' || swing.contactAtMs < releasedMs) return advanced
  const pitch = derbyPitch(advanced.derby, advanced.derby.pitchIndex)
  const event: SwingEvent = {
    source: swing.source,
    contactMs: swing.contactAtMs - releasedMs,
    startedMs: swing.startedAtMs - releasedMs,
    speed: swing.speed,
    heightError: swing.batHeight === null ? null : swing.batHeight - contactHeight(pitch),
  }
  const finished = finishPitch(advanced.derby, event, swing.contactAtMs)
  return { derby: finished.derby, events: [...advanced.events, ...finished.events] }
}

export function isFiniteSwing(swing: DerbySwing) {
  const measured = [swing.contactAtMs, swing.startedAtMs, swing.speed, swing.batHeight ?? 0]
  return measured.every(Number.isFinite)
}

/** The one phase change due by `nowMs`, or null when none is; a time that is not a number makes none due. */
export function nextDerbyStep(derby: Derby, nowMs: number): DerbyUpdate | null {
  const endsMs = phaseEndMs(derby)
  if (endsMs === null || !(nowMs >= endsMs)) return null
  if (derby.phase === 'ready') return startWindup(derby, endsMs)
  if (derby.phase === 'windup') return releasePitch(derby, endsMs)
  if (derby.phase === 'pitch') return finishPitch(derby, null, endsMs)
  return nextPitch(derby, endsMs)
}

/** When the current phase is due to end, or null once the run is over. */
export function phaseEndMs(derby: Derby) {
  if (derby.phase === 'finished') return null
  if (derby.phase === 'pitch') return derby.phaseStartedMs + swingDeadlineMs(derby)
  if (derby.phase === 'result') return derby.phaseStartedMs + RESULT_HOLD_MS[derby.results[derby.pitchIndex].outcome]
  return derby.phaseStartedMs + DERBY_PHASE_MS[derby.phase]
}

/** How long after the release the current pitch takes a swing (ms): see swingDeadlineForPitch. */
export function swingDeadlineMs(derby: Derby) {
  return swingDeadlineForPitch(derby, derbyPitch(derby, derby.pitchIndex))
}

/** The flight of the run's pitch `pitchIndex` at the derby's pace. */
export function derbyPitch(derby: Derby, pitchIndex: number) {
  return planRunPitch(derby.plan, pitchIndex, derby.pitchFlightSeconds)
}

/**
 * How long after its release `pitch` takes a swing (ms): to the latest swing the derby takes (`lateLimitMs`), plus the
 * margin for a camera swing reported after it happened.
 */
export function swingDeadlineForPitch(derby: Derby, pitch: PitchPlan) {
  return contactReferenceMs(derby, pitch) + derby.lateLimitMs + LATE_SWING_MARGIN_MS
}

/** How long after its release (ms) a swing can still touch `pitch`, under this run's rules and calibration. */
export function latestContactMs(derby: Derby, pitch: PitchPlan) {
  const contactWindowMs = DIFFICULTY_RULES[derby.plan.rules.difficulty].timingWindows.contact
  return contactReferenceMs(derby, pitch) + contactWindowMs
}

/** The contact reference after `pitch`'s release (ms), moved later by a calibration that finds the swings late. */
export function contactReferenceMs(derby: Derby, pitch: PitchPlan) {
  return contactSeconds(pitch) * 1000 + Math.max(0, derby.calibration.offsetMs)
}

export function startWindup(derby: Derby, atMs: number): DerbyUpdate {
  return {
    derby: { ...derby, phase: 'windup', phaseStartedMs: atMs },
    events: [{ type: 'windup', pitchIndex: derby.pitchIndex }],
  }
}

export function releasePitch(derby: Derby, atMs: number): DerbyUpdate {
  const pitch = derbyPitch(derby, derby.pitchIndex)
  return {
    derby: { ...derby, phase: 'pitch', phaseStartedMs: atMs },
    events: [{ type: 'release', pitchIndex: derby.pitchIndex, pitch, releasedMs: atMs }],
  }
}

/** Ends the current pitch with `swing`, or with none when it went by, scored the way a replay scores it. */
export function finishPitch(derby: Derby, swing: SwingEvent | null, atMs: number): DerbyUpdate {
  const log = { ...derby.log, swings: [...derby.log.swings, swing] }
  const result = scorePitch(derby.plan, derby.calibration, log, derby.pitchIndex, derby.pitchFlightSeconds)
  return {
    derby: { ...derby, log, results: [...derby.results, result], phase: 'result', phaseStartedMs: atMs },
    events: [{ type: 'result', pitchIndex: derby.pitchIndex, result, swing }],
  }
}

/** The next pitch's ready phase, or after the last result the finished run, replayed from its log. */
export function nextPitch(derby: Derby, atMs: number): DerbyUpdate {
  const pitchIndex = derby.pitchIndex + 1
  if (pitchIndex < derby.plan.schedule.length) {
    return { derby: { ...derby, pitchIndex, phase: 'ready', phaseStartedMs: atMs }, events: [] }
  }
  return {
    derby: { ...derby, phase: 'finished', phaseStartedMs: atMs },
    events: [{ type: 'finished', result: replayDerby(derby.plan, derby.log, derby.pitchFlightSeconds) }],
  }
}
