import { type AppLanguage, languageCopy } from '../../i18n/language'
import { homeRunTotals } from '../game/derbyScore'
import {
  bannerResult,
  bannerText,
  captionId,
  type DerbyHudState,
  homeRunDistanceText,
  settledResults,
} from './derbyCues'

/**
 * The run as it plays, sized to read from a step back: the scoreboard and a two- or three-word caption in the top band,
 * and once a result's ball is down, its distance and details under the play. It knows only what the stage's events
 * told it (derbyCues.ts), never the pitches to come. The caption and banner are one live region, so a screen reader
 * hears each cue and result. Space and Enter swing anywhere (BaseballApp); the button is for a pointer.
 */
export function DerbyHud({
  hud,
  pitchCount,
  language,
  onSwing,
}: {
  hud: DerbyHudState
  pitchCount: number
  language: AppLanguage
  onSwing: (timeStamp: number) => void
}) {
  const copy = languageCopy[language].baseball.hud
  const score = homeRunTotals(settledResults(hud))
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
            <span>{copy.longest}</span>
            <strong>{homeRunDistanceText(score.longestHomeRunDecimetres, language)}</strong>
          </p>
        </div>
      </div>
      <div className="derby-callout" aria-live="polite" aria-atomic="true">
        <p className="derby-caption">{copy.captions[captionId(hud)]}</p>
        {banner && (
          <p className={`derby-banner ${shown.outcome}`}>
            {banner.distance && <strong>{banner.distance}</strong>}
            <span>{banner.detail}</span>
          </p>
        )}
      </div>
      {hud.phase !== 'finished' && (
        <button className="derby-swing" type="button" onPointerDown={(event) => onSwing(event.timeStamp)}>
          {copy.swing}
          <kbd>Space</kbd>
        </button>
      )}
    </div>
  )
}
