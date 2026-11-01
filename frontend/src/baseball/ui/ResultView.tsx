import type { CSSProperties, Ref } from 'react'
import { type AppLanguage, languageCopy } from '../../i18n/language'
import { type BaseballExit, EXIT_PATHS } from '../baseballRoute'
import type { DerbyResult } from '../game/derbyScore'
import { homeRunDistanceText, resultRow } from './derbyCues'
import { StanceGauge } from './StanceGauge'

/**
 * A finished run as `replayDerby` scored it from its plan and input log, so these are the numbers a server recomputing
 * the run gets: home runs first, then their summed distance, which ranks runs with as many, both sized to read from
 * where the visitor bats, and beside them a row per pitch with how it ended and how far a ball in play went. Distances
 * show to the decimeter they are scored in, so two totals that rank apart never read the same; the live HUD rounds to
 * meters. No timing, power, or pitch type is shown. Holding the batting stance fills `gauge` and plays again, as the
 * button does, while `stanceNeed` says what the hold waits for.
 */
export function ResultView({
  result,
  exit,
  gauge,
  stanceNeed,
  language,
  onPlayAgain,
}: {
  result: DerbyResult
  exit: BaseballExit
  gauge: Ref<HTMLDivElement>
  stanceNeed: string | null
  language: AppLanguage
  onPlayAgain: () => void
}) {
  const copy = languageCopy[language].baseball
  return (
    <section
      className="baseball-card derby-result"
      aria-labelledby="derby-result-title"
      style={{ '--pitch-rows': result.pitches.length } as CSSProperties}
    >
      <p className="eyebrow">{copy.result.eyebrow}</p>
      <h1 id="derby-result-title">{copy.result.title(result.homeRuns)}</h1>
      <dl className="derby-result-stats">
        <div>
          <dt>{copy.result.homeRuns}</dt>
          <dd>
            {result.homeRuns}/{result.plan.schedule.length}
          </dd>
        </div>
        <div>
          <dt>{copy.result.homeRunDistance}</dt>
          <dd>{homeRunDistanceText(result.homeRunDistanceDecimetres, language, 1)}</dd>
        </div>
      </dl>
      <ol className="derby-result-pitches" aria-label={copy.result.pitches}>
        {result.pitches.map((pitch, index) => {
          const row = resultRow(pitch, language)
          return (
            <li key={index} data-outcome={row.outcome}>
              <span>{copy.result.outcomes[row.outcome]}</span>
              {row.distance && <span>{row.distance}</span>}
            </li>
          )
        })}
      </ol>
      <StanceGauge ref={gauge} label={copy.flow.stance} hint={copy.flow.toPlayAgain} need={stanceNeed} />
      <div className="derby-actions">
        <button className="primary-button" type="button" autoFocus onClick={onPlayAgain}>
          {copy.result.playAgain}
        </button>
        <a className="baseball-back" href={EXIT_PATHS[exit]}>
          {copy.back[exit]}
        </a>
      </div>
    </section>
  )
}
