import type { MouseEvent } from 'react'
import { BASEBALL_PATH, BOARD_PATH } from '../baseball/baseballRoute'
import { rankingMonth } from '../data/ballparkRules'
import { linkedInChipText, recordText, rowName } from '../data/boardRecord'
import type { BoardRow } from '../data/leaderboardApi'
import { usePodium } from '../hooks/usePodium'
import { type AppLanguage, languageCopy, monthName } from '../i18n/language'
import type { StatueRank } from '../scene/statues/statueFinishes'

type StatueCardProps = {
  rank: StatueRank
  language: AppLanguage
  /** Leaves the town for a page of the ballpark's the way its gate does, saving where the visitor stands. */
  onLeave: (href: string) => void
}

/**
 * The card beside a statue in the podium garden, open while the visitor stands near it (town-statues §0-4): who holds
 * the place this month and their record, their LinkedIn link only when they opted in and the admin approved it (never
 * on the statue itself), and the way to the board; an empty place invites a swing instead. It reads the same monthly
 * statues as the garden, so the card never names someone the pedestal does not show.
 */
export function StatueCard({ rank, language, onLeave }: StatueCardProps) {
  const podium = usePodium()
  const season = podium?.season ?? rankingMonth(new Date())
  const row = podium?.rows.find((candidate) => candidate.rank === rank) ?? null
  const month = languageCopy[language].venues.ballpark.statues.month(monthName(season, season, language))
  // A click that asks for a new tab or window stays an ordinary link.
  const leave = (event: MouseEvent<HTMLAnchorElement>) => {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
    event.preventDefault()
    onLeave(event.currentTarget.pathname)
  }
  return (
    <section className="statue-card" data-rank={rank} aria-labelledby="statue-card-title">
      <span className="statue-card-medal" aria-hidden="true">
        {rank}
      </span>
      {row ? (
        <StandingCard row={row} month={month} language={language} onLeave={leave} />
      ) : (
        <WaitingCard
          rank={rank}
          month={month}
          firstStatue={podium?.rows.length === 0}
          language={language}
          onLeave={leave}
        />
      )}
    </section>
  )
}

type CardLinkHandler = (event: MouseEvent<HTMLAnchorElement>) => void

export function StandingCard({
  row,
  month,
  language,
  onLeave,
}: {
  row: BoardRow
  month: string
  language: AppLanguage
  onLeave: CardLinkHandler
}) {
  const copy = languageCopy[language]
  const name = rowName(row, language)
  return (
    <div className="statue-card-body">
      <p className="statue-card-eyebrow">
        <span className="statue-card-place">{copy.baseball.leaderboard.plaqueLive(row.rank)}</span>
        {month}
      </p>
      <h2 id="statue-card-title" data-placeholder={row.nameState !== 'approved' || undefined}>
        {name}
      </h2>
      <p className="statue-card-record">{recordText(row.homeRuns, row.totalDistanceDm, language)}</p>
      <div className="statue-card-actions">
        {row.linkedInProfileUrl && (
          <a
            className="statue-card-linkedin"
            href={row.linkedInProfileUrl}
            target="_blank"
            rel="ugc nofollow noopener noreferrer"
            aria-label={copy.baseball.leaderboard.linkedInLabel(name)}
          >
            <span className="statue-card-linkedin-icon" aria-hidden="true">
              in
            </span>
            <span className="statue-card-linkedin-handle">{linkedInChipText(row.linkedInProfileUrl)}</span>
            <span aria-hidden="true">↗</span>
          </a>
        )}
        <a className="statue-card-link" href={BOARD_PATH} onClick={onLeave}>
          {copy.venues.ballpark.statues.ranking} <span aria-hidden="true">›</span>
        </a>
      </div>
    </div>
  )
}

export function WaitingCard({
  rank,
  month,
  firstStatue,
  language,
  onLeave,
}: {
  rank: StatueRank
  month: string
  /** No one stands on any pedestal this month yet; unknown while the statues cannot be read. */
  firstStatue: boolean
  language: AppLanguage
  onLeave: CardLinkHandler
}) {
  const copy = languageCopy[language]
  const statues = copy.venues.ballpark.statues
  return (
    <div className="statue-card-body">
      <p className="statue-card-eyebrow">
        <span className="statue-card-place">{statues.place(rank)}</span>
        {month}
      </p>
      <h2 id="statue-card-title">{statues.waiting}</h2>
      <p className="statue-card-record">{firstStatue ? statues.firstStatue : statues.waitingHint}</p>
      <div className="statue-card-actions">
        <a className="statue-card-link is-primary" href={BASEBALL_PATH} onClick={onLeave}>
          {copy.baseball.leaderboard.challenge} <span aria-hidden="true">›</span>
        </a>
        <a className="statue-card-link" href={BOARD_PATH} onClick={onLeave}>
          {statues.ranking}
        </a>
      </div>
    </div>
  )
}
