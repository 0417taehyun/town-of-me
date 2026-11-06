import type { CSSProperties, Ref } from 'react'
import { type AppLanguage, languageCopy } from '../../i18n/language'
import type { PracticeFeedback } from '../flow/derbyFlow'
import { MORE_PRACTICE_SCHEDULE } from '../game/pitchSchedule'
import { captionShown, type DerbyHudState, practiceCaptionId, textEms } from './derbyCues'
import { StanceGauge } from './StanceGauge'

/**
 * Practice as it plays, read from a step back: which practice pitch this is, in the top corner on the batter's side,
 * and over the play a two- or three-word caption that says, after each swing, only whether it was a bit early, good,
 * or a bit late; never a number, a speed, or a power. The caption is a live region, so a screen reader hears each one,
 * also those that do not show while a pitch comes (captionShown); `cameraState`, what the camera panel's chip shows, is
 * another, heard only. While practice is `paused` for a visitor out of view it says practice waits for them.
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
  const captionId = practiceCaptionId(hud, feedback)
  const caption = paused ? copy.hud.paused : copy.practice.captions[captionId]
  return (
    <div className="derby-hud derby-practice">
      <p className="derby-pitches">
        <span>{copy.practice.title}</span>
        <strong>
          {Math.min(hud.pitchIndex + 1, pitchCount)}/{pitchCount}
        </strong>
      </p>
      <div className="derby-callout" aria-live="polite" aria-atomic="true">
        <p
          className="derby-caption"
          data-feedback={paused ? undefined : (feedback ?? undefined)}
          data-shown={captionShown(captionId, paused) || undefined}
          style={{ '--caption-ems': textEms(caption) } as CSSProperties}
        >
          {caption}
        </p>
      </div>
      <p className="derby-camera-state" role="status">
        {cameraState}
      </p>
    </div>
  )
}

/**
 * The step after practice: practice is done, and holding the batting stance fills `gauge` and goes on, as the main
 * button does, which has focus so Enter or Space presses it; `stanceNeed` says what the hold waits for. Going on plays
 * ball, unless practice did not `timed` the visitor's swings (game/calibration.ts findsUsualTiming): then it is more
 * practice, and another button plays on anyway, on the note that the runs take no usual timing off and are not ranked.
 * `cameraState` is the camera panel chip's words, heard only.
 */
export function PracticeDoneView({
  gauge,
  stanceNeed,
  timed,
  language,
  cameraState,
  onGo,
  onPlayAnyway,
}: {
  gauge: Ref<HTMLDivElement>
  stanceNeed: string | null
  timed: boolean
  language: AppLanguage
  cameraState: string | null
  onGo: () => void
  onPlayAnyway: () => void
}) {
  const copy = languageCopy[language].baseball
  const hint = timed ? copy.flow.toPlay : copy.practice.toMorePractice(MORE_PRACTICE_SCHEDULE.length)
  return (
    <section className="baseball-card derby-practice-done" aria-labelledby="derby-practice-done-title">
      <h1 id="derby-practice-done-title">{timed ? copy.practice.doneTitle : copy.practice.doneTitleUntimed}</h1>
      <p className="baseball-note">{timed ? copy.practice.doneNote : copy.practice.doneNoteUntimed}</p>
      <StanceGauge ref={gauge} label={copy.flow.stance} hint={hint} need={stanceNeed} />
      <div className="derby-actions">
        <button className="primary-button" type="button" autoFocus onClick={onGo}>
          {timed ? copy.flow.playBall : copy.practice.morePractice}
        </button>
        {!timed && (
          <button className="derby-secondary" type="button" onClick={onPlayAnyway}>
            {copy.practice.playAnyway}
          </button>
        )}
      </div>
      <p className="derby-camera-state" role="status">
        {cameraState}
      </p>
    </section>
  )
}
