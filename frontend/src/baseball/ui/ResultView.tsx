import type { CSSProperties, Ref } from 'react'
import { type AppLanguage, languageCopy } from '../../i18n/language'
import { type BaseballExit, BOARD_PATH, EXIT_PATHS } from '../baseballRoute'
import type { BoardLine } from '../flow/rankedRun'
import type { DerbyResult } from '../game/derbyScore'
import { boardLineText, homeRunDistanceText, resultRow } from './derbyCues'
import { StanceGauge } from './StanceGauge'

/**
 * What the result card says and offers of the monthly board: its `line` (null for a preview), whether a statue's
 * record could show the visitor's LinkedIn link, and the listing card to open or the result to send again.
 */
export type ResultBoard = { line: BoardLine | null; offerLinkedIn: boolean; onOpen: () => void; onRetry: () => void }

/**
 * A finished run as `replayDerby` scored it from its plan and input log, so these are the numbers a server recomputing
 * the run gets: home runs first, then their summed distance, which ranks runs with as many, both sized to read from
 * where the visitor bats, then where the run left the visitor on the monthly board, also read from there, and a row per
 * pitch with how it ended and how far a ball in play went. Distances show to the decimeter they are scored in, so two
 * totals that rank apart never read the same; the live HUD rounds to meters. No timing, power, or pitch type is shown.
 * Holding the batting stance fills `gauge` and plays again, as the button does, while `stanceNeed` says what the hold
 * waits for. Beside it is the way to the listing card, or to send a result that failed again, and to the board.
 */
export function ResultView({
  result,
  board,
  exit,
  gauge,
  stanceNeed,
  language,
  onPlayAgain,
}: {
  result: DerbyResult
  board: ResultBoard
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
      <p className="derby-board-line" role="status" data-kind={board.line?.kind}>
        {board.line && boardLineText(board.line, language)}
      </p>
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
        <BoardAction board={board} language={language} />
        {board.line && (
          <a className="derby-secondary" href={BOARD_PATH}>
            {copy.leaderboard.viewBoard}
          </a>
        )}
        <a className="baseball-back" href={EXIT_PATHS[exit]}>
          {copy.back[exit]}
        </a>
        {board.line && board.line.kind !== 'unranked' && <p className="derby-data-notice">{copy.board.dataNotice}</p>}
      </div>
    </section>
  )
}

/**
 * The result card's one way to the board: a record off it can go on, one on it opens the listing card (asking first
 * whether a statue should show the visitor's LinkedIn), and a result that could not be saved tries again.
 */
export function BoardAction({ board, language }: { board: ResultBoard; language: AppLanguage }) {
  const copy = languageCopy[language].baseball.board
  const { line } = board
  if (line?.kind === 'unsaved' && line.reason === 'failed')
    return (
      <button className="derby-secondary" type="button" onClick={board.onRetry}>
        {copy.retry}
      </button>
    )
  const offBoard = line?.kind === 'offBoard' || line?.kind === 'consentNeeded'
  const onBoard = line?.kind === 'statue' || line?.kind === 'newBest' || line?.kind === 'bestStands'
  if (!offBoard && !onBoard) return null
  const ownLabel = board.offerLinkedIn ? copy.offerLinkedIn : copy.own
  return (
    <button className="derby-secondary" type="button" onClick={board.onOpen}>
      {offBoard ? copy.list : ownLabel}
    </button>
  )
}
