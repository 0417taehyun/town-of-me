import { useEffect, useState } from 'react'
import { rankingWeek } from '../../data/ballparkRules'
import { recordText, rowName } from '../../data/boardRecord'
import { type BoardRow, fetchHallOfFame, type HallOfFameSeason } from '../../data/leaderboardApi'
import type { TownSnapshot } from '../../data/models'
import { usePageLanguage } from '../../hooks/usePageLanguage'
import { type AppLanguage, languageCopy, weekName } from '../../i18n/language'
import { STATUE_RANKS, type StatueRank } from '../../scene/statues/statueFinishes'
import { BOARD_PATH } from '../baseballRoute'
import {
  BoardLoadFailed,
  BoardLoading,
  BoardNoticeLinks,
  BoardTopline,
  Portrait,
  RecordMenu,
  StatueLinkedIn,
} from './BoardPage'
import { seasonSearch } from './boardSeason'
import { useRead } from './useBoard'
import '../baseball.css'
import './board.css'

/**
 * Every finished season at /baseball/ranking?view=hall-of-fame, newest first, each with its three statues small: a
 * name, a record, a verified link only as the server sends it, and the menu to report one or ask for its removal.
 * Like the board it opens only behind the ballpark's gate.
 */
export function HallOfFamePage({ town }: { town: TownSnapshot }) {
  const [language, setLanguage] = usePageLanguage()
  const copy = languageCopy[language]
  const boardCopy = copy.baseball.leaderboard
  const [currentSeason] = useState(() => rankingWeek(new Date()))
  const { load, reload } = useRead(fetchHallOfFame)
  const contactEmail = town.owner.contactEmail

  useEffect(() => {
    document.title = boardCopy.hallOfFameDocumentTitle
  }, [boardCopy.hallOfFameDocumentTitle])

  return (
    <main className="board-page">
      {/* The board keeps names, characters, and statues' links with no end date; nginx sends X-Robots-Tag too. */}
      <meta name="robots" content="noindex, noarchive" />
      <div className="board-column">
        <BoardTopline
          backHref={BOARD_PATH}
          backLabel={boardCopy.backToBoard}
          running={Boolean(contactEmail)}
          language={language}
          onLanguage={setLanguage}
        />
        <header className="board-heading">
          <p className="eyebrow">{boardCopy.eyebrow(copy.venues.ballpark.themes[town.venues.ballpark.theme])}</p>
          <div className="board-title-row">
            <h1>{boardCopy.hallOfFameTitle}</h1>
          </div>
          <p className="board-meta">{boardCopy.hallOfFameIntro}</p>
        </header>
        {!contactEmail && <p className="board-state">{boardCopy.notRunning}</p>}
        {contactEmail && load.status === 'loading' && <BoardLoading />}
        {contactEmail && load.status === 'failed' && <BoardLoadFailed language={language} onRetry={reload} />}
        {contactEmail && load.status === 'ready' && (
          <>
            <HallOfFameSeasons
              seasons={load.value}
              currentSeason={currentSeason}
              contactEmail={contactEmail}
              language={language}
            />
            <footer className="board-footer">
              <BoardNoticeLinks contactEmail={contactEmail} language={language} />
            </footer>
          </>
        )}
      </div>
    </main>
  )
}

export function HallOfFameSeasons({
  seasons,
  currentSeason,
  contactEmail,
  language,
}: {
  seasons: readonly HallOfFameSeason[]
  currentSeason: string
  contactEmail: string
  language: AppLanguage
}) {
  const copy = languageCopy[language].baseball.leaderboard
  if (seasons.length === 0)
    return (
      <div className="board-hall-empty board-list-empty">
        <p>
          <b>{copy.hallOfFameEmpty}</b>
        </p>
        <p>{copy.hallOfFameEmptyHint}</p>
      </div>
    )
  return (
    <ol className="board-hall-seasons">
      {seasons.map((season) => (
        <HallOfFameSeasonCard
          key={season.id}
          season={season}
          currentSeason={currentSeason}
          contactEmail={contactEmail}
          language={language}
        />
      ))}
    </ol>
  )
}

/** A season's card: its week, the way to its final board, and a statue or an empty pedestal for each place. */
export function HallOfFameSeasonCard({
  season,
  currentSeason,
  contactEmail,
  language,
}: {
  season: HallOfFameSeason
  currentSeason: string
  contactEmail: string
  language: AppLanguage
}) {
  const copy = languageCopy[language].baseball.leaderboard
  const week = weekName(season.id, currentSeason, language)
  return (
    <li className="board-hall-season">
      <div className="board-hall-season-head">
        <h2>{copy.season(week)}</h2>
        <a href={`${BOARD_PATH}${seasonSearch(season.id)}`}>
          {copy.finalListTitle(week)} <span aria-hidden="true">›</span>
        </a>
      </div>
      <ol className="board-hall-statues">
        {STATUE_RANKS.map((rank) => (
          <HallOfFameStatue
            key={rank}
            rank={rank}
            row={season.champions.find((row) => row.rank === rank) ?? null}
            season={season.id}
            contactEmail={contactEmail}
            language={language}
          />
        ))}
      </ol>
    </li>
  )
}

/** A place in a season's card: the record's portrait on its pedestal over its name, or the bare pedestal. */
export function HallOfFameStatue({
  rank,
  row,
  season,
  contactEmail,
  language,
}: {
  rank: StatueRank
  row: BoardRow | null
  season: string
  contactEmail: string
  language: AppLanguage
}) {
  const copy = languageCopy[language].baseball.leaderboard
  if (!row)
    return (
      <li className="board-hall-statue" data-rank={rank} data-empty="">
        <HallOfFameFigure rank={rank} row={null} />
        <p className="board-hall-name">{copy.pedestalLeftEmpty}</p>
      </li>
    )
  const name = rowName(row, language)
  return (
    <li className="board-hall-statue" data-rank={rank}>
      <HallOfFameFigure rank={rank} row={row} />
      <p className="board-hall-name" data-placeholder={row.nameState !== 'shown' || undefined}>
        {name}
      </p>
      <p className="board-hall-record">{recordText(row.homeRuns, row.totalDistanceDm, language)}</p>
      <div className="board-plate-link">
        {row.linkedInProfileUrl && (
          <StatueLinkedIn profileUrl={row.linkedInProfileUrl} name={name} language={language} />
        )}
        <RecordMenu row={row} name={name} season={season} contactEmail={contactEmail} language={language} />
      </div>
    </li>
  )
}

export function HallOfFameFigure({ rank, row }: { rank: StatueRank; row: BoardRow | null }) {
  return (
    <div className="board-hall-figure">
      <span className="board-medal" data-rank={rank} aria-hidden="true">
        {rank}
      </span>
      {row ? <Portrait profile={row.profile} className="board-portrait" /> : <span className="board-portrait" />}
      <span className="board-hall-pedestal" aria-hidden="true" />
    </div>
  )
}
