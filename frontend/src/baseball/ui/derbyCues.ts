import type { DerbySound } from '../../audio/derbySounds'
import { type AppLanguage, languageCopy } from '../../i18n/language'
import type { PracticeFeedback } from '../flow/derbyFlow'
import type { DerbyPhase } from '../game/derby'
import { homeRunTotals, type PitchResult } from '../game/derbyScore'
import type { StageEvent } from '../stage/stageRun'

// The derby's cues, made from the stage's events: what the HUD shows and what the speakers play. The HUD keeps only the
// phase, which pitch, the results so far, and which pitch's ball last came down; a release tells it nothing about the
// pitch, so the pitch type can reach the screen only in a result, after the pitch.

/** `phase` is null before the first pitch's windup; `settledPitch` is the last pitch whose ball has come down. */
export type DerbyHudState = {
  phase: DerbyPhase | null
  pitchIndex: number
  results: PitchResult[]
  settledPitch: number
}

export const NEW_RUN_HUD: DerbyHudState = { phase: null, pitchIndex: 0, results: [], settledPitch: -1 }

export function hudAfterEvent(hud: DerbyHudState, event: StageEvent): DerbyHudState {
  if (event.type === 'windup') return { ...hud, phase: 'windup', pitchIndex: event.pitchIndex }
  if (event.type === 'release') return { ...hud, phase: 'pitch' }
  if (event.type === 'result') return { ...hud, phase: 'result', results: [...hud.results, event.result] }
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

/** A home run's ball still in the air, which the camera chases: the camera panel steps aside to a corner meanwhile. */
export function chasingHomeRun(hud: DerbyHudState) {
  const latest = hud.results.at(-1)
  return hud.phase === 'result' && latest?.outcome === 'homeRun' && hud.settledPitch !== hud.results.length - 1
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

/** The sound a stage event makes: the bat at contact, the mitt at a catch, and the crowd for a home run. */
export function derbySoundFor(event: StageEvent): DerbySound | null {
  if (event.type === 'contact') return 'bat'
  if (event.type === 'caught') return 'mitt'
  if (event.type === 'result' && event.result.outcome === 'homeRun') return 'crowd'
  return null
}
