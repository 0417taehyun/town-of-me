import type { DerbySound } from '../../audio/derbySounds'
import { distanceText, recordText } from '../../data/boardRecord'
import type { LinkedInStatus } from '../../data/leaderboardApi'
import { type AppLanguage, languageCopy } from '../../i18n/language'
import type { CameraStateId } from '../cameraTracking'
import { type DerbyFlow, offersMorePractice, type PracticeFeedback } from '../flow/derbyFlow'
import type { BoardLine } from '../flow/rankedRun'
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
  if (judged) return pitchOutcome(judged)
  if (hud.phase === 'finished') return 'finished'
  if (hud.phase === null) return 'ready'
  return 'coming'
}

/** The outcomes a big title pops up for: a ball in play's, a pitch let go by (a strike), or a swing that missed it. */
export type OutcomeTitleId = 'homeRun' | 'hit' | 'foul' | 'strike' | 'miss'

/** How a pitch ended, as the caption, the big title, and the result card name it: one let go by is a strike. */
export function pitchOutcome(result: PitchResult): OutcomeTitleId {
  return result.timing === null ? 'strike' : result.outcome
}

/**
 * The big title over the play for the latest pitch, once its outcome is seen: a ball in play's as the camera starts
 * chasing it, so it never covers the bat meeting the ball, and a strike's or a miss's as the mitt catches the pitch;
 * until the next windup. It names the outcome only: the banner under the play waits for the ball to come down.
 */
export function outcomeTitle(hud: DerbyHudState): OutcomeTitleId | null {
  const judged = judgedResult(hud)
  if (!judged) return null
  const latest = hud.results.length - 1
  const seen = judged.outcome === 'miss' ? hud.settledPitch === latest : hud.chasedPitch === latest
  if (!seen) return null
  return pitchOutcome(judged)
}

/** Practice's caption: before it, a pitch on its way, then the swing's word, or a nudge after a pitch let go by. */
export type PracticeCaptionId = 'start' | 'coming' | 'letGo' | PracticeFeedback

/** The captions that show over the play: practice's word for a swing, or its nudge after a pitch let go by. */
export const SHOWN_CAPTIONS: ReadonlySet<CaptionId | PracticeCaptionId> = new Set(['letGo', 'early', 'good', 'late'])

/**
 * Whether the caption shows over the play rather than only in a screen reader's ear: while practice or the run is
 * `paused` for a visitor out of view, and for practice's word after each pitch (SHOWN_CAPTIONS). Not while a pitch
 * comes, so it never covers the pitcher or the pitch, nor for a run's outcome, which the big title shows (outcomeTitle),
 * nor before the first pitch, which the held stance's big word has just started.
 */
export function captionShown(caption: CaptionId | PracticeCaptionId, paused: boolean) {
  return paused || SHOWN_CAPTIONS.has(caption)
}

export function practiceCaptionId(hud: DerbyHudState, feedback: PracticeFeedback | null): PracticeCaptionId {
  if (feedback) return feedback
  if (hud.phase === null) return 'start'
  return hud.phase === 'result' ? 'letGo' : 'coming'
}

/** How far a ball in play went, to `fractionDigits` of a meter; a foul's, a strike's, or a miss's distance says nothing. */
export function inPlayDistance(result: PitchResult, language: AppLanguage, fractionDigits = 0) {
  const inPlay = result.outcome === 'homeRun' || result.outcome === 'hit'
  return inPlay ? distanceText(result.distanceDecimetres, language, fractionDigits) : null
}

/**
 * A pitch's row on the result card: how it ended and, for a ball in play, how far it went, to the decimeter the run's
 * total is scored in. Like the banner, it never says how the swing was timed or how hard it was, and unlike the banner,
 * not what the pitch was either.
 */
export function resultRow(result: PitchResult, language: AppLanguage) {
  return { outcome: pitchOutcome(result), distance: inPlayDistance(result, language, 1) }
}

/** The result card's line about the weekly board (flow/rankedRun.ts boardLine). */
export function boardLineText(line: BoardLine, language: AppLanguage) {
  const copy = languageCopy[language].baseball.board
  if (line.kind === 'unranked') return copy.unranked[line.reason]
  if (line.kind === 'unsaved') return copy.unsaved[line.reason]
  if (line.kind === 'statue' || line.kind === 'newBest') return copy[line.kind](line.rank)
  if (line.kind === 'offBoard' || line.kind === 'consentNeeded') return copy[line.kind](line.wouldBeRank)
  if (line.kind === 'bestStands') {
    return copy.bestStands(line.rank, recordText(line.homeRuns, line.totalDistanceDm, language))
  }
  return copy[line.kind]
}

/** Where the visitor's LinkedIn link stands on their statue (backend/README.md "Ranked runs"). */
export function linkedInStatusText(status: LinkedInStatus, language: AppLanguage) {
  const copy = languageCopy[language].baseball.board
  if (status === 'approved') return copy.linkedInShown
  return status === 'reported' ? copy.linkedInHidden : copy.linkedInCode
}

/**
 * The banner under a result: how far a ball in play went, and what the pitch was. It never says how the swing was
 * timed or how hard it was: the outcome and the distance say how it went.
 */
export function bannerText(result: PitchResult, language: AppLanguage) {
  const copy = languageCopy[language].baseball.hud
  return {
    distance: inPlayDistance(result, language),
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
 * Whether a step's `stanceNeed` (null while none waits) stands in for the swing tracker's `caption`: in place of a
 * swing's directions, so the camera panel never tells a visitor holding the stance to swing; the lock's captions still
 * show.
 */
export function stanceStandsIn(caption: TrackerReason | null, stanceNeed: string | null) {
  return stanceNeed !== null && (caption === null || SWING_DIRECTIONS.has(caption))
}

/**
 * The camera's words once it sees the visitor, under the camera panel's picture and in a screen reader's ear: the
 * swing tracker's `caption`, or the stance a step waits for in place of a swing's directions (stanceStandsIn).
 */
export function seenCameraState(caption: TrackerReason | null, stanceNeed: string | null, language: AppLanguage) {
  if (stanceStandsIn(caption, stanceNeed)) return stanceNeed
  return caption && languageCopy[language].baseball.camera.tracker[caption]
}

/**
 * The camera panel chip's colour and word, for where the swing tracker is: looking for the visitor or an object, put
 * right (a hand out of view, the wrong side, a sweep that was no swing), ready to load, loaded, or a swing seen.
 */
export type CameraTone = 'searching' | 'help' | 'locked' | 'loaded' | 'swing'

export const CAPTION_TONES: Record<TrackerReason, CameraTone> = {
  showHands: 'help',
  looking: 'searching',
  holdStill: 'searching',
  locking: 'searching',
  locked: 'locked',
  free: 'locked',
  lost: 'locked',
  tapNearHands: 'help',
  pullBack: 'locked',
  otherSide: 'help',
  loaded: 'loaded',
  swing: 'swing',
  swingThrough: 'help',
  faster: 'help',
  bigger: 'help',
  unclear: 'help',
  stayPut: 'help',
}

/** The camera panel's words: a chip above the picture, coloured by `tone`, and a line under it to read from 2 m. */
export type CameraPanelWords = { tone: CameraTone; chip: string; headline: string | null }

/**
 * The camera panel's words for the camera's state (`stateId`, cameraStateId): while it starts or looks for the
 * visitor, the chip says so; once it sees them, the chip follows the swing tracker's `caption` and the line under it
 * says what to do. While a step's `stanceNeed` stands in for a swing's directions, the chip says only whether the hands
 * are loaded, never a swing to fix or a swing seen. Null while the camera is off.
 */
export function cameraPanelWords(
  stateId: CameraStateId | null,
  caption: TrackerReason | null,
  stanceNeed: string | null,
  language: AppLanguage,
): CameraPanelWords | null {
  const copy = languageCopy[language].baseball.camera
  if (stateId === 'starting') return { tone: 'searching', chip: copy.states.starting, headline: null }
  if (stateId === 'searching') return { tone: 'searching', chip: copy.states.searching, headline: copy.stepIn }
  if (stateId !== 'seen') return null
  const tone = stanceStandsIn(caption, stanceNeed) ? stanceTone(caption) : CAPTION_TONES[caption ?? 'looking']
  return { tone, chip: copy.tones[tone], headline: seenCameraState(caption, stanceNeed, language) }
}

export function stanceTone(caption: TrackerReason | null): CameraTone {
  return caption === 'loaded' ? 'loaded' : 'locked'
}

/**
 * About how many ems wide `text` sets: a Hangul or other wide character takes one, anything else a little over half,
 * so the camera panel's chip can set a word as large as its width allows.
 */
export function textEms(text: string) {
  const wide = text.match(/[\u1100-\u11ff\u3000-\u9fff\uac00-\ud7af\uff00-\uffef]/gu)?.length ?? 0
  return wide + (text.length - wide) * 0.58
}

/** The scoreboard's labels' size as a share of its figures' (baseball.css .derby-scoreboard: 6vh to 14vh). */
export const SCOREBOARD_LABEL_SHARE = 6 / 14

/** A scoreboard box's padding on both sides and its gap to the next box, in its figures' ems (baseball.css). */
export const SCOREBOARD_BOX_EMS = 0.45

/** A figure on the scoreboard with the label over it. */
export type ScoreboardStat = { label: string; figure: string }

/**
 * About how many ems of its figures the scoreboard sets wide, so baseball.css can set them as large as the room beside
 * the pitch line holds it.
 */
export function scoreboardEms(stats: readonly ScoreboardStat[]) {
  return stats.reduce((sum, stat) => sum + scoreboardBoxEms(stat), 0)
}

/** A scoreboard box's ems: as wide as its figure or its smaller label, whichever is wider, and its padding. */
export function scoreboardBoxEms({ label, figure }: ScoreboardStat) {
  return Math.max(textEms(label) * SCOREBOARD_LABEL_SHARE, figureEms(figure)) + SCOREBOARD_BOX_EMS
}

/**
 * About how many ems wide a scoreboard figure sets in its heavy weight, a little over rather than under: a digit about
 * 0.7, a separator or space about 0.36, and anything else (the meter sign, the dash before a distance) up to one.
 */
export function figureEms(figure: string) {
  const digits = figure.match(/\d/gu)?.length ?? 0
  const separators = figure.match(/[\s,.]/gu)?.length ?? 0
  return digits * 0.7 + separators * 0.36 + (figure.length - digits - separators)
}

/** How long (ms) the big word stays up once the held stance has filled the gauge. */
export const HELD_WORD_MS = 1300

/** The big word as the held stance fills the gauge at `flow`, saying what it starts; null on a step that waits for none. */
export function heldStanceWord(flow: Pick<DerbyFlow, 'step' | 'practice'>, language: AppLanguage) {
  const words = languageCopy[language].baseball.flow.held
  if (flow.step === 'setup' || offersMorePractice(flow)) return words.practice
  if (flow.step === 'practiceDone') return words.play
  return flow.step === 'result' ? words.again : null
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
