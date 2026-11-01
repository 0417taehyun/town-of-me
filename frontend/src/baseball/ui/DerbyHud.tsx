import { type AppLanguage, languageCopy } from '../../i18n/language'
import {
  bannerResult,
  bannerText,
  captionId,
  type DerbyHudState,
  homeRunDistanceText,
  scoreboardTotals,
} from './derbyCues'

/**
 * The run as it plays, sized to read from a step back: the scoreboard (home runs, then their summed distance, the two
 * things a run ranks by, each counting a home run as its banner shows) and a two- or three-word caption in the top
 * band, and once a result's ball is down, its distance and details under the play. It knows only what the stage's
 * events told it (derbyCues.ts), never the pitches to come. The caption and banner are one live region, so a screen
 * reader hears each cue and result; `cameraState`, what the camera panel's chip shows, is another, heard only. While
 * the run is `paused` for a visitor out of the camera's view, the caption says so. Results show the outcome, the
 * distance, and the pitch type, never how the swing was timed or its power. In a keyboard run Space and Enter swing
 * anywhere (BaseballApp) and `onSwing` gives a pointer a button; a camera run has none.
 */
export function DerbyHud({
  hud,
  pitchCount,
  paused,
  language,
  cameraState,
  onSwing,
}: {
  hud: DerbyHudState
  pitchCount: number
  paused: boolean
  language: AppLanguage
  cameraState: string | null
  onSwing: ((timeStamp: number) => void) | null
}) {
  const copy = languageCopy[language].baseball.hud
  const score = scoreboardTotals(hud)
  const shown = bannerResult(hud)
  const banner = shown && bannerText(shown, language)
  return (
    <div className="derby-hud">
      <div className="derby-scoreboard">
        <p className="derby-stat">
          <span>{copy.pitch}</span>
          <strong>
            {Math.min(hud.pitchIndex + 1, pitchCount)}/{pitchCount}
          </strong>
        </p>
        <div className="derby-stat-group">
          <p className="derby-stat">
            <span>{copy.homeRuns}</span>
            <strong>{score.homeRuns}</strong>
          </p>
          <p className="derby-stat">
            <span>{copy.homeRunDistance}</span>
            <strong>{homeRunDistanceText(score.homeRunDistanceDecimetres, language)}</strong>
          </p>
        </div>
      </div>
      <div className="derby-callout" aria-live="polite" aria-atomic="true">
        <p className="derby-caption">{paused ? copy.paused : copy.captions[captionId(hud)]}</p>
        {banner && (
          <p className={`derby-banner ${shown.outcome}`}>
            {banner.distance && <strong>{banner.distance}</strong>}
            <span>{banner.detail}</span>
          </p>
        )}
      </div>
      <p className="derby-camera-state" role="status">
        {cameraState}
      </p>
      {onSwing && hud.phase !== 'finished' && (
        <button className="derby-swing" type="button" onPointerDown={(event) => onSwing(event.timeStamp)}>
          {copy.swing}
          <kbd>Space</kbd>
        </button>
      )}
    </div>
  )
}
