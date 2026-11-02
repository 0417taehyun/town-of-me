import type { CSSProperties } from 'react'
import { type AppLanguage, languageCopy } from '../../i18n/language'
import {
  bannerResult,
  bannerText,
  captionId,
  captionShown,
  type DerbyHudState,
  homeRunDistanceText,
  outcomeTitle,
  pitchDots,
  scoreboardEms,
  scoreboardTotals,
  textEms,
} from './derbyCues'

/**
 * The run as it plays, sized to read from where the visitor bats. In the top corner on the batter's side, a dot per
 * pitch, coloured by how it ended once its ball is down, the one up next ringed; in the corner over the camera panel,
 * the scoreboard: home runs, then their summed distance, the two things a run ranks by, each counting a home run as its
 * banner shows. Both stay clear of the pitch line (baseball.css). A big title pops up and fades as a pitch's outcome is
 * seen (outcomeTitle), and once a result's ball is down, its distance and details show under the play. It knows only
 * what the stage's events told it (derbyCues.ts), never the pitches to come. The caption, which says where the run is,
 * and the banner are one live region, so a screen reader hears each cue and result; on screen the caption shows only
 * while the run is `paused` for a visitor out of the camera's view (captionShown), so it never covers a pitch nor says
 * the title again. `cameraState`, what the camera panel's chip shows, is another live region, heard only. Results show
 * the outcome, the distance, and the pitch type, never how the swing was timed or its power. It has no swing button:
 * only the camera swings.
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
  const stats = [
    { label: copy.homeRuns, figure: String(score.homeRuns) },
    { label: copy.homeRunDistance, figure: homeRunDistanceText(score.homeRunDistanceDecimetres, language) },
  ]
  const shown = bannerResult(hud)
  const banner = shown && bannerText(shown, language)
  const title = outcomeTitle(hud)
  const titleText = title && copy.titles[title]
  const caption = paused ? copy.paused : copy.captions[captionId(hud)]
  return (
    <div className="derby-hud">
      <div className="derby-pitches">
        <span>{copy.pitch}</span>
        <strong className="derby-pitch-dots">
          {pitchDots(hud, pitchCount).map((dot, index) => (
            <i key={index} data-dot={dot} aria-hidden="true" />
          ))}
          <span className="derby-pitch-count">
            {Math.min(hud.pitchIndex + 1, pitchCount)}/{pitchCount}
          </span>
        </strong>
      </div>
      <div className="derby-scoreboard" style={{ '--scoreboard-ems': scoreboardEms(stats) } as CSSProperties}>
        {stats.map((stat) => (
          <p key={stat.label} className="derby-stat">
            <span>{stat.label}</span>
            <strong>{stat.figure}</strong>
          </p>
        ))}
      </div>
      {titleText && (
        <p
          key={hud.pitchIndex}
          className="derby-outcome-title"
          data-outcome={title}
          data-paused={paused || undefined}
          style={{ '--title-ems': textEms(titleText) } as CSSProperties}
          aria-hidden="true"
        >
          {titleText}
        </p>
      )}
      <div className="derby-callout" aria-live="polite" aria-atomic="true">
        <p
          className="derby-caption"
          data-shown={captionShown(captionId(hud), paused) || undefined}
          style={{ '--caption-ems': textEms(caption) } as CSSProperties}
        >
          {caption}
        </p>
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
