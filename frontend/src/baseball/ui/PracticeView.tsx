import type { Ref } from 'react'
import { type AppLanguage, languageCopy } from '../../i18n/language'
import type { PracticeFeedback } from '../flow/derbyFlow'
import { type DerbyHudState, practiceCaptionId } from './derbyCues'
import { StanceGauge } from './StanceGauge'

/**
 * Practice as it plays, read from a step back: which practice pitch this is, and a two- or three-word caption that
 * says, after each swing, only whether it was a bit early, good, or a bit late; never a number, a speed, or a power.
 * The caption is a live region, so a screen reader hears each one; `cameraState`, what the camera panel's chip shows,
 * is another, heard only. While practice is `paused` for a visitor out of view it says practice waits for them.
 */
export function PracticeView({
  hud,
  pitchCount,
  feedback,
  paused,
  language,
  cameraState,
}: {
  hud: DerbyHudState
  pitchCount: number
  feedback: PracticeFeedback | null
  paused: boolean
  language: AppLanguage
  cameraState: string | null
}) {
  const copy = languageCopy[language].baseball
  return (
    <div className="derby-hud derby-practice">
      <div className="derby-scoreboard">
        <p className="derby-stat">
          <span>{copy.practice.title}</span>
          <strong>
            {Math.min(hud.pitchIndex + 1, pitchCount)}/{pitchCount}
          </strong>
        </p>
      </div>
      <div className="derby-callout" aria-live="polite" aria-atomic="true">
        <p className="derby-caption" data-feedback={paused ? undefined : (feedback ?? undefined)}>
          {paused ? copy.hud.paused : copy.practice.captions[practiceCaptionId(hud, feedback)]}
        </p>
      </div>
      <p className="derby-camera-state" role="status">
        {cameraState}
      </p>
    </div>
  )
}

/**
 * The step after practice: practice is done, and holding the batting stance fills `gauge` and plays ball, as the
 * button does, which has focus so Enter or Space presses it; `stanceNeed` says what the hold waits for. Unless
 * practice `timed` the visitor's swings (game/calibration.ts findsUsualTiming), it says the runs take no usual timing
 * off, though practice showed its first swings on their own timing. `cameraState` is the camera panel chip's words,
 * heard only.
 */
export function PracticeDoneView({
  gauge,
  stanceNeed,
  timed,
  language,
  cameraState,
  onPlay,
}: {
  gauge: Ref<HTMLDivElement>
  stanceNeed: string | null
  timed: boolean
  language: AppLanguage
  cameraState: string | null
  onPlay: () => void
}) {
  const copy = languageCopy[language].baseball
  return (
    <section className="baseball-card derby-practice-done" aria-labelledby="derby-practice-done-title">
      <h1 id="derby-practice-done-title">{copy.practice.doneTitle}</h1>
      <p className="baseball-note">{timed ? copy.practice.doneNote : copy.practice.doneNoteUntimed}</p>
      <StanceGauge ref={gauge} label={copy.flow.stance} hint={copy.flow.toPlay} need={stanceNeed} />
      <div className="derby-actions">
        <button className="primary-button" type="button" autoFocus onClick={onPlay}>
          {copy.flow.playBall}
        </button>
      </div>
      <p className="derby-camera-state" role="status">
        {cameraState}
      </p>
    </section>
  )
}
