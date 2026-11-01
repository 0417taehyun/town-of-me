import type { DerbySound } from '../../audio/derbySounds'
import { type AppLanguage, languageCopy } from '../../i18n/language'
import type { PracticeFeedback } from '../flow/derbyFlow'
import { STANCE_HOLD_RULES, type StanceNeed } from '../flow/stanceHold'
import type { DerbyPhase } from '../game/derby'
import { homeRunTotals, type PitchResult } from '../game/derbyScore'
import type { BattingSide } from '../game/field'
import type { StageEvent } from '../stage/stageRun'
import type { TrackerReason } from '../vision/swingTracker'

// The derby's cues, made from the stage's events: what the HUD shows and what the speakers play. The HUD keeps only the
// phase, which pitch, the results so far, and which pitch's ball the camera last chased and which last came down; a
// release tells it nothing about the pitch, so the pitch type can reach the screen only in a result, after the pitch.

/**
 * `phase` is null before the first pitch's windup; `chasedPitch` is the last pitch whose ball in play the camera has
 * started chasing, and `settledPitch` the last whose ball has come down.
 */
export type DerbyHudState = {
  phase: DerbyPhase | null
  pitchIndex: number
  results: PitchResult[]
  chasedPitch: number
  settledPitch: number
}

export const NEW_RUN_HUD: DerbyHudState = { phase: null, pitchIndex: 0, results: [], chasedPitch: -1, settledPitch: -1 }

export function hudAfterEvent(hud: DerbyHudState, event: StageEvent): DerbyHudState {
  if (event.type === 'windup') return { ...hud, phase: 'windup', pitchIndex: event.pitchIndex }
  if (event.type === 'release') return { ...hud, phase: 'pitch' }
  if (event.type === 'result') return { ...hud, phase: 'result', results: [...hud.results, event.result] }
  if (event.type === 'chase') return { ...hud, chasedPitch: event.pitchIndex }
  if (event.type === 'caught' || event.type === 'landed') return { ...hud, settledPitch: event.pitchIndex }
  if (event.type === 'finished') return { ...hud, phase: 'finished' }
  return hud
}

/**
 * The scoreboard's home runs and their summed distance, from the results whose balls have come down, so a home run
 * counts as its banner shows it.
 */
export function scoreboardTotals(hud: DerbyHudState) {
  return homeRunTotals(hud.results.slice(0, hud.settledPitch + 1))
}

/** A pitch's dot on the scoreboard: how it ended (a strike or a miss is an out), the one up next, or one to come. */
export type PitchDot = 'homeRun' | 'hit' | 'foul' | 'out' | 'current' | 'coming'

/**
 * A dot for each of the run's `pitchCount` pitches, coloured by how it ended once its ball is down, as the scoreboard
 * counts it, so no dot says more than the caption has; until then the pitch up next is ringed.
 */
export function pitchDots(hud: DerbyHudState, pitchCount: number): PitchDot[] {
  const settled = hud.results.slice(0, hud.settledPitch + 1)
  return Array.from({ length: pitchCount }, (_, index) => pitchDot(settled[index], index === hud.pitchIndex))
}

export function pitchDot(result: PitchResult | undefined, upNext: boolean): PitchDot {
  if (result) return result.outcome === 'miss' ? 'out' : result.outcome
  return upNext ? 'current' : 'coming'
}

/**
 * The result the banner shows: the latest pitch's, once its ball is in the mitt or on the grass, until the next windup.
 * Shown no sooner, the banner never covers the bat meeting the ball or the ball's flight.
 */
export function bannerResult(hud: DerbyHudState): PitchResult | null {
  const settled = hud.settledPitch === hud.results.length - 1
  return hud.phase === 'result' && settled ? (hud.results.at(-1) ?? null) : null
}

/**
 * Whether no ball is in play and a pitch of the run's `pitchCount` is still to come: before the first windup, and once
 * a result's ball is down until the next windup, but not after the last pitch, whose result goes on to the run's end.
 */
export function betweenPitches(hud: DerbyHudState, pitchCount: number) {
  if (hud.phase === null) return true
  return bannerResult(hud) !== null && hud.results.length < pitchCount
}

/**
 * Whether a pitch is in play: from its windup until it is judged and its ball is down, in the mitt or on the grass, so
 * the swing, the bat's last stretch to the ball, and the ball's flight play out. The object detector rests meanwhile,
 * since a run of it holds up the camera's frames and the page's drawing alike.
 */
export function pitchInPlay(hud: DerbyHudState) {
  if (hud.phase === 'windup' || hud.phase === 'pitch') return true
  return hud.phase === 'result' && hud.settledPitch !== hud.results.length - 1
}

/**
 * A home run's ball still in the air, once the camera chases it: the camera panel steps aside to a corner meanwhile.
 * Not sooner, so the play does not slide aside while the hit-stop holds the bat on the ball.
 */
export function chasingHomeRun(hud: DerbyHudState) {
  const latest = hud.results.length - 1
  const homeRun = hud.results[latest]?.outcome === 'homeRun'
  return hud.phase === 'result' && homeRun && hud.chasedPitch === latest && hud.settledPitch !== latest
}

/** A pitch let go by is a strike; one swung at and missed is a miss. */
export type CaptionId = 'ready' | 'coming' | 'finished' | 'strike' | PitchResult['outcome']

/** The latest pitch's result from when it is judged until the next windup; null before it and meanwhile. */
export function judgedResult(hud: DerbyHudState): PitchResult | null {
  return hud.phase === 'result' ? (hud.results.at(-1) ?? null) : null
}

/** The two or three words that say where the run is; the same for every pitch until its result. */
export function captionId(hud: DerbyHudState): CaptionId {
  const judged = judgedResult(hud)
  if (judged) return judged.timing === null ? 'strike' : judged.outcome
  if (hud.phase === 'finished') return 'finished'
  if (hud.phase === null) return 'ready'
  return 'coming'
}

/** Practice's caption: before it, a pitch on its way, then the swing's word, or a nudge after a pitch let go by. */
export type PracticeCaptionId = 'start' | 'coming' | 'letGo' | PracticeFeedback

export function practiceCaptionId(hud: DerbyHudState, feedback: PracticeFeedback | null): PracticeCaptionId {
  if (feedback) return feedback
  if (hud.phase === null) return 'start'
  return hud.phase === 'result' ? 'letGo' : 'coming'
}

/**
 * A distance as each language writes it, in whole meters unless `fractionDigits` asks for more: "132 m" in English,
 * "132m" in Korean.
 */
export function distanceText(decimetres: number, language: AppLanguage, fractionDigits = 0) {
  const format = new Intl.NumberFormat(language, {
    style: 'unit',
    unit: 'meter',
    maximumFractionDigits: fractionDigits,
  })
  return format.format(decimetres / 10)
}

/** A home run distance, or a dash before there is one. */
export function homeRunDistanceText(decimetres: number, language: AppLanguage, fractionDigits = 0) {
  return decimetres > 0 ? distanceText(decimetres, language, fractionDigits) : '—'
}

/**
 * The banner under a result: how far a ball in play went, and what the pitch was. It never says how the swing was
 * timed or how hard it was: the outcome and the distance say how it went.
 */
export function bannerText(result: PitchResult, language: AppLanguage) {
  const copy = languageCopy[language].baseball.hud
  const inPlay = result.outcome === 'homeRun' || result.outcome === 'hit'
  return {
    distance: inPlay ? distanceText(result.distanceDecimetres, language) : null,
    detail: copy.pitchWas[result.pitchType],
  }
}

/** What the stance gauge's line says the hold waits for, naming the back shoulder of a visitor batting on `side`. */
export function stanceNeedText(need: StanceNeed, side: BattingSide, language: AppLanguage) {
  const words = languageCopy[language].baseball.flow.needs[need]
  return typeof words === 'string' ? words : words[side]
}

/** The swing tracker's captions that direct a swing: where the grip loads, a swing seen, what a sweep lacked. */
export const SWING_DIRECTIONS: ReadonlySet<TrackerReason> = new Set<TrackerReason>([
  'pullBack',
  'otherSide',
  'loaded',
  'swing',
  'swingThrough',
  'faster',
  'bigger',
  'unclear',
  'stayPut',
])

/**
 * The camera panel chip's words once the camera sees the visitor: the swing tracker's `caption`, except while a step
 * waits for the stance, whose `stanceNeed` (null while none waits) stands in for a swing's directions, so the chip
 * never tells a visitor holding the stance to swing; the lock's captions still show.
 */
export function seenCameraState(caption: TrackerReason | null, stanceNeed: string | null, language: AppLanguage) {
  if (stanceNeed !== null && (caption === null || SWING_DIRECTIONS.has(caption))) return stanceNeed
  return caption && languageCopy[language].baseball.camera.tracker[caption]
}

/**
 * The sound a stage event makes: a whistle at the windup, a puff as the pitch leaves the hand, a whoosh as the batter
 * swings, the bat at contact, the mitt at a catch, and the crowd for a home run.
 */
export function derbySoundFor(event: StageEvent): DerbySound | null {
  if (event.type === 'windup') return 'windup'
  if (event.type === 'release') return 'release'
  if (event.type === 'swing') return 'whoosh'
  if (event.type === 'contact') return 'bat'
  if (event.type === 'caught') return 'mitt'
  if (event.type === 'result' && event.result.outcome === 'homeRun') return 'crowd'
  return null
}

/**
 * Whether the stance gauge, filling from `before` to `after` (0..1 of its hold), passed one of the hold's whole seconds
 * short of full, where it ticks; a full gauge dings instead, and one draining or starting over is silent.
 */
export function stanceTicked(before: number, after: number) {
  const seconds = STANCE_HOLD_RULES.holdMs / 1000
  return after < 1 && Math.floor(after * seconds) > Math.floor(before * seconds)
}
