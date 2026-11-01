import { type AppLanguage, languageCopy } from '../../i18n/language'
import {
  bannerResult,
  bannerText,
  captionId,
  type DerbyHudState,
  homeRunDistanceText,
  pitchDots,
  scoreboardTotals,
} from './derbyCues'

/**
 * The run as it plays, sized to read from a step back: the scoreboard (a dot per pitch, coloured by how it ended once
 * its ball is down, the one up next ringed; home runs, then their summed distance, the two things a run ranks by, each
 * counting a home run as its banner shows) and a two- or three-word caption in the top band, and once a result's ball
 * is down, its distance and details under the play. It knows only what the stage's events told it (derbyCues.ts),
 * never the pitches to come. The caption and banner are one live region, so a screen reader hears each cue and result;
 * `cameraState`, what the camera panel's chip shows, is another, heard only. While the run is `paused` for a visitor
 * out of the camera's view, the caption says so. Results show the outcome, the distance, and the pitch type, never how
 * the swing was timed or its power. It has no swing button: only the camera swings.
 */
export function DerbyHud({
  hud,
  pitchCount,
  paused,
  language,
  cameraState,
}: {
  hud: DerbyHudState
  pitchCount: number
  paused: boolean
  language: AppLanguage
  cameraState: string | null
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
          <strong className="derby-pitch-dots">
            {pitchDots(hud, pitchCount).map((dot, index) => (
              <i key={index} data-dot={dot} aria-hidden="true" />
            ))}
            <span className="derby-pitch-count">
              {Math.min(hud.pitchIndex + 1, pitchCount)}/{pitchCount}
            </span>
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
    </div>
  )
}
