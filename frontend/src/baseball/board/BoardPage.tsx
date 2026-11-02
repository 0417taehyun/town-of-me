import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  effectiveBallparkRules,
  nextRankingMonth,
  previousRankingMonth,
  rankingMonth,
  upcomingBallparkRules,
} from '../../data/ballparkRules'
import { getBrowserSessionStore, readStoredSession } from '../../data/InMemoryDemoRepository'
import {
  type Board,
  type BoardOwnEntry,
  type BoardRow,
  deleteOwnRecords,
  type ListingChoice,
  reportBoardEntry,
  type ReportReason,
  type ReportTarget,
  updateOwnRecord,
} from '../../data/leaderboardApi'
import type { TownSnapshot } from '../../data/models'
import type { PlayerProfile } from '../../data/playerProfile'
import { usePageLanguage } from '../../hooks/usePageLanguage'
import { useReducedMotion } from '../../hooks/useReducedMotion'
import { type AppLanguage, languageCopy, monthName } from '../../i18n/language'
import { copyText } from '../../scene/webglSupport'
import { STATUE_RANKS, type StatueRank } from '../../scene/statues/statueFinishes'
import { LanguageSelect } from '../../ui/LanguageSelect'
import { BASEBALL_PATH, BOARD_PATH } from '../baseballRoute'
import { homeRunDistanceText, linkedInStatusText, recordText } from '../ui/derbyCues'
import { ListingView } from '../ui/ListingView'
import { BoardPodium } from './BoardPodium'
import { daysUntilSeasonEnds, oldestShownSeason, requestedSeason, seasonEndsAt, seasonSearch } from './boardSeason'
import {
  hasSeenReveal,
  isOwnRow,
  linkedInChipText,
  listingBatter,
  noteRevealSeen,
  ownHeadline,
  recordNumber,
  rowName,
  seasonResetText,
  statueLooks,
  takedownHref,
} from './boardView'
import { usePortrait } from './portraitImages'
import { useBoard } from './useBoard'
import '../baseball.css'
import './board.css'

/**
 * The monthly board at /baseball/ranking (`?season=YYYY-MM` for a past month's final board): the top three as painted
 * statues over their name plates, places 4 to 50 as a list, and the visitor's own record between them, which they
 * can post, hide, or change here. The statues rise third to first the first time this browser sees a month's board.
 * Names show once the admin approved them, and a LinkedIn link only on a statue. Phones may read it too.
 */
export function BoardPage({ town }: { town: TownSnapshot }) {
  const [language, setLanguage] = usePageLanguage()
  const copy = languageCopy[language].baseball.leaderboard
  const [currentSeason] = useState(() => rankingMonth(new Date()))
  const [season, setSeason] = useState(() => requestedSeason(window.location.search, currentSeason))
  const { load, reload } = useBoard(season)
  const contactEmail = town.owner.contactEmail

  useEffect(() => {
    document.title = copy.documentTitle
  }, [copy.documentTitle])

  const goTo = (next: string | null) => {
    window.history.replaceState(null, '', `${BOARD_PATH}${seasonSearch(next)}`)
    setSeason(next)
  }
  const shownSeason = season ?? currentSeason

  return (
    <main className="board-page">
      <div className="board-column">
        <nav className="board-topline">
          <a className="baseball-back" href={BASEBALL_PATH}>
            <span aria-hidden="true">‹</span> {copy.back}
          </a>
          <div className="board-topline-actions">
            <LanguageSelect language={language} className="baseball-language-select" onChange={setLanguage} />
            {contactEmail && (
              <a className="primary-button compact" href={BASEBALL_PATH}>
                {copy.challenge}
              </a>
            )}
          </div>
        </nav>
        <SeasonHeading
          town={town}
          season={shownSeason}
          currentSeason={currentSeason}
          language={language}
          onSeason={(next) => goTo(next === currentSeason ? null : next)}
        />
        {!contactEmail && <p className="board-state">{copy.notRunning}</p>}
        {contactEmail && load.status === 'loading' && (
          <div className="board-state" aria-busy="true">
            <span className="loader" aria-hidden="true" />
          </div>
        )}
        {contactEmail && load.status === 'failed' && (
          <div className="board-state" role="alert">
            <p>{copy.loadFailed}</p>
            <button className="primary-button compact" type="button" onClick={reload}>
              {languageCopy[language].baseball.board.retry}
            </button>
          </div>
        )}
        {contactEmail && load.status === 'ready' && (
          <BoardSections
            key={load.board.season.id}
            board={load.board}
            lastSeason={load.lastSeason}
            town={town}
            contactEmail={contactEmail}
            currentSeason={currentSeason}
            language={language}
            onReload={reload}
            onSeason={(next) => goTo(next)}
          />
        )}
      </div>
    </main>
  )
}

/** The title, the season and the buttons to the others, and for this month when it ends and the rules it plays. */
export function SeasonHeading({
  town,
  season,
  currentSeason,
  language,
  onSeason,
}: {
  town: TownSnapshot
  season: string
  currentSeason: string
  language: AppLanguage
  onSeason: (season: string) => void
}) {
  const copy = languageCopy[language]
  const boardCopy = copy.baseball.leaderboard
  const venueCopy = copy.venues.ballpark
  const { ballpark } = town.venues
  const [now] = useState(Date.now)
  const month = monthName(season, currentSeason, language)
  const current = season === currentSeason
  const endsAt = current ? seasonEndsAt(season) : null
  const rules = effectiveBallparkRules(ballpark, currentSeason)
  const upcoming = upcomingBallparkRules(ballpark, currentSeason)
  return (
    <header className="board-heading">
      <p className="eyebrow">{boardCopy.eyebrow(venueCopy.themes[ballpark.theme])}</p>
      <div className="board-title-row">
        <h1>{current ? boardCopy.title : boardCopy.finalTitle(month)}</h1>
        <div className="board-season">
          <button
            type="button"
            className="board-season-step"
            aria-label={boardCopy.previousSeason}
            disabled={season <= oldestShownSeason(currentSeason)}
            onClick={() => onSeason(previousRankingMonth(season))}
          >
            ‹
          </button>
          <p className="board-season-pill">
            <b>{boardCopy.season(month)}</b>
            <span aria-hidden="true">·</span>
            <span>{endsAt ? boardCopy.daysLeft(daysUntilSeasonEnds(endsAt, now)) : boardCopy.seasonOver}</span>
          </p>
          <button
            type="button"
            className="board-season-step"
            aria-label={boardCopy.nextSeason}
            disabled={current}
            onClick={() => onSeason(nextRankingMonth(season))}
          >
            ›
          </button>
        </div>
      </div>
      {current && (
        <p className="board-meta">
          {endsAt && <span>{seasonResetText(endsAt, language)}</span>}
          <span>{venueCopy.rulesThisMonth(rules.pitchCount, venueCopy.difficulties[rules.difficulty])}</span>
          {upcoming && (
            <span>
              {venueCopy.rulesFrom(
                monthName(upcoming.fromMonth, currentSeason, language),
                upcoming.rules.pitchCount,
                venueCopy.difficulties[upcoming.rules.difficulty],
              )}
            </span>
          )}
        </p>
      )}
    </header>
  )
}

export function BoardSections({
  board,
  lastSeason,
  town,
  contactEmail,
  currentSeason,
  language,
  onReload,
  onSeason,
}: {
  board: Board
  lastSeason: Board | null
  town: TownSnapshot
  contactEmail: string
  currentSeason: string
  language: AppLanguage
  onReload: () => void
  onSeason: (season: string) => void
}) {
  const copy = languageCopy[language].baseball.leaderboard
  const reducedMotion = useReducedMotion()
  const { season, podium, ranks, own } = board
  const month = monthName(season.id, currentSeason, language)
  const emptyMonth = !season.final && podium.length === 0
  const [revealing, setRevealing] = useState(() => !season.final && podium.length > 0 && !hasSeenReveal(season.id))
  const [shownPlates, setShownPlates] = useState<ReadonlySet<StatueRank>>(() => new Set(revealing ? [] : STATUE_RANKS))
  const [listing, setListing] = useState(false)
  const looks = useMemo(() => statueLooks(podium), [podium])

  useEffect(() => {
    if (revealing) noteRevealSeen(season.id)
  }, [revealing, season.id])
  useEffect(() => {
    if (!listing) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setListing(false)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [listing])

  const finishReveal = useCallback(() => {
    setRevealing(false)
    setShownPlates(new Set(STATUE_RANKS))
  }, [])
  const showPlate = useCallback((rank: StatueRank) => setShownPlates((current) => new Set([...current, rank])), [])
  const sessionProfile = useMemo(() => readStoredSession(getBrowserSessionStore(), town.id)?.profile ?? null, [town.id])

  return (
    <>
      <section className="board-podium" aria-labelledby="board-statues-title" data-empty={emptyMonth || undefined}>
        <h2 id="board-statues-title" className="sr-only">
          {copy.statues}
        </h2>
        <div className="board-stage" onPointerDown={revealing ? finishReveal : undefined}>
          <Bunting />
          <BoardPodium
            language={language}
            looks={looks}
            revealing={revealing && !reducedMotion}
            reducedMotion={reducedMotion}
            onPlateShown={showPlate}
            onRevealEnd={finishReveal}
          />
          {emptyMonth && (
            <div className="board-empty-banner">
              <p>
                <b>{copy.emptyMonth}</b>
              </p>
              <p>{copy.emptyMonthHint}</p>
              <a className="primary-button compact" href={BASEBALL_PATH}>
                {copy.challenge}
              </a>
            </div>
          )}
        </div>
        <ol className="board-plates">
          {STATUE_RANKS.map((rank) => (
            <BoardPlate
              key={rank}
              rank={rank}
              row={podium.find((row) => row.rank === rank) ?? null}
              finalMonth={season.final ? month : null}
              shown={shownPlates.has(rank) || reducedMotion}
              challenge={!season.final && !emptyMonth}
              contactEmail={contactEmail}
              language={language}
            />
          ))}
        </ol>
        {lastSeason && lastSeason.podium.length > 0 && (
          <LastSeasonStrip board={lastSeason} currentSeason={currentSeason} language={language} onSeason={onSeason} />
        )}
      </section>
      <OwnRecordCard
        own={own}
        final={season.final}
        month={month}
        language={language}
        onOpen={() => setListing(true)}
        onUnlist={async () => {
          await updateOwnRecord({ listed: false }).catch(() => undefined)
          onReload()
        }}
      />
      <section className="board-list-card" aria-labelledby="board-list-title">
        <div className="board-list-head">
          <h2 id="board-list-title">{season.final ? copy.finalListTitle(month) : copy.listTitle}</h2>
          {ranks.length > 0 && <p>{copy.listFrom(ranks.length)}</p>}
        </div>
        {ranks.length > 0 ? (
          <>
            <div className="board-columns" aria-hidden="true">
              <span>{copy.columns.rank}</span>
              <span />
              <span>{copy.columns.batter}</span>
              <span>{copy.columns.homeRuns}</span>
              <span>{copy.columns.distance}</span>
              <span />
            </div>
            <ol className="board-list">
              {ranks.map((row) => (
                <BoardListRow
                  key={row.id}
                  row={row}
                  own={isOwnRow(row, own) ? own : null}
                  contactEmail={contactEmail}
                  language={language}
                />
              ))}
            </ol>
          </>
        ) : (
          <div className="board-list-empty">
            <p>
              <b>{season.final ? copy.listEmptyFinal : copy.listEmpty}</b>
            </p>
            <p>{copy.listEmptyHint}</p>
          </div>
        )}
        <p className="board-tie-rule">{copy.tieRule}</p>
      </section>
      <footer className="board-footer">
        <a href={takedownHref(contactEmail, copy.takedown)}>{copy.takedown}</a>
      </footer>
      {listing && own && !season.final && (
        <div className="board-dialog" role="dialog" aria-modal="true" aria-labelledby="derby-listing-title">
          <ListingView
            key={own.listed ? 'listed' : 'unlisted'}
            entry={own}
            batter={listingBatter(own, sessionProfile)}
            name={own.name ?? sessionProfile?.name ?? null}
            language={language}
            onSave={async (choice: ListingChoice) => {
              await updateOwnRecord(choice)
              setListing(false)
              onReload()
            }}
            onDelete={async () => {
              await deleteOwnRecords()
              setListing(false)
              onReload()
            }}
            onClose={() => setListing(false)}
          />
        </div>
      )}
    </>
  )
}

/** The festive bunting along the podium's sky. */
export function Bunting() {
  const flags = ['#ca7765', '#ece3cc', '#6f987c', '#d8b879', '#638fab', '#79647c']
  return (
    <svg className="board-bunting" viewBox="0 0 1000 60" preserveAspectRatio="xMidYMin slice" aria-hidden="true">
      <path d="M0 6 Q500 40 1000 6" fill="none" stroke="currentColor" strokeWidth="1.5" opacity="0.45" />
      {Array.from({ length: 15 }, (_, index) => {
        const x = 33.3 + index * 66.67
        const sag = 23 - ((x - 500) / 500) ** 2 * 15
        return (
          <path
            key={index}
            d="M-15 0 L15 0 L0 26 Z"
            fill={flags[index % flags.length]}
            transform={`translate(${x} ${sag}) rotate(${((500 - x) / 500) * 3.6})`}
          />
        )
      })}
    </svg>
  )
}

/** A statue's name plate: its place, the plaque's words, the name, the record, and a LinkedIn chip if approved. */
export function BoardPlate({
  rank,
  row,
  finalMonth,
  shown,
  challenge,
  contactEmail,
  language,
}: {
  rank: StatueRank
  row: BoardRow | null
  finalMonth: string | null
  shown: boolean
  challenge: boolean
  contactEmail: string
  language: AppLanguage
}) {
  const copy = languageCopy[language].baseball.leaderboard
  if (!row)
    return (
      <li className="board-plate" data-rank={rank} data-empty="" data-hidden={!shown || undefined}>
        <span className="board-medal" aria-hidden="true">
          {rank}
        </span>
        <p className="board-plate-name">{copy.emptyPedestal}</p>
        {challenge && (
          <a className="board-plate-challenge" href={BASEBALL_PATH}>
            {copy.challenge}
          </a>
        )}
      </li>
    )
  const name = rowName(row, language)
  return (
    <li className="board-plate" data-rank={rank} data-hidden={!shown || undefined}>
      <span className="board-medal" aria-hidden="true">
        {rank}
      </span>
      <p className="board-plate-label">{finalMonth ? copy.plaqueFinal(finalMonth, rank) : copy.plaqueLive(rank)}</p>
      <p className="board-plate-name" data-placeholder={row.nameState !== 'approved' || undefined}>
        {name}
      </p>
      <p className="board-plate-record">{recordText(row.homeRuns, row.totalDistanceDm, language)}</p>
      <div className="board-plate-link">
        {row.linkedInProfileUrl && (
          <a
            className="board-linkedin"
            href={row.linkedInProfileUrl}
            target="_blank"
            rel="ugc nofollow noopener noreferrer"
            aria-label={copy.linkedInLabel(name)}
          >
            <span className="board-linkedin-icon" aria-hidden="true">
              in
            </span>
            <span className="board-linkedin-handle">{linkedInChipText(row.linkedInProfileUrl)}</span>
            <span aria-hidden="true">↗</span>
          </a>
        )}
        <RecordMenu row={row} name={name} contactEmail={contactEmail} language={language} />
      </div>
    </li>
  )
}

/**
 * A record's [⋯]: report its name, character, or link, copy its number, or ask for its removal by mail. A report is
 * answered the same whatever the board did with it, so the page says the same too.
 */
export function RecordMenu({
  row,
  name,
  contactEmail,
  language,
}: {
  row: BoardRow
  name: string
  contactEmail: string
  language: AppLanguage
}) {
  const copy = languageCopy[language].baseball.leaderboard
  const [linkReason, setLinkReason] = useState(false)
  const [done, setDone] = useState<string | null>(null)
  const number = recordNumber(row.id)
  const report = (target: ReportTarget, reason: ReportReason) => {
    setLinkReason(false)
    void reportBoardEntry(row.id, target, reason)
      .catch(() => undefined)
      .then(() => setDone(copy.reportDone[reason]))
  }
  const copyNumber = async () => {
    const copied = await copyText(number, navigator.clipboard)
    if (copied) setDone(copy.copied)
  }
  return (
    <details className="board-menu">
      <summary aria-label={copy.more(name)}>
        <span aria-hidden="true">⋯</span>
      </summary>
      <div className="board-menu-items">
        {row.nameState === 'approved' && (
          <button type="button" onClick={() => report('name', 'other')}>
            {copy.reportName}
          </button>
        )}
        {row.profile && (
          <button type="button" onClick={() => report('character', 'other')}>
            {copy.reportCharacter}
          </button>
        )}
        {row.linkedInProfileUrl && !linkReason && (
          <button type="button" onClick={() => setLinkReason(true)}>
            {copy.reportLink}
          </button>
        )}
        {linkReason && (
          <>
            <button type="button" onClick={() => report('link', 'mine')}>
              {copy.reportMine}
            </button>
            <button type="button" onClick={() => report('link', 'other')}>
              {copy.reportOther}
            </button>
          </>
        )}
        <button type="button" onClick={copyNumber}>
          {copy.copyRecordNumber} <code>{number}</code>
        </button>
        <a href={takedownHref(contactEmail, copy.takedownSubject(number))}>{copy.takedown}</a>
        <p className="board-menu-done" role="status">
          {done}
        </p>
      </div>
    </details>
  )
}

/** A small portrait of a record's character, or of the default batter; empty until it is drawn. */
export function Portrait({ profile, className }: { profile: PlayerProfile | null; className: string }) {
  const source = usePortrait(profile)
  return <span className={className}>{source && <img src={source} alt="" />}</span>
}

/** A place on the list: its number, the character, the name, home runs, distance, and the record's menu. */
export function BoardListRow({
  row,
  own,
  contactEmail,
  language,
}: {
  row: BoardRow
  own: BoardOwnEntry | null
  contactEmail: string
  language: AppLanguage
}) {
  const copy = languageCopy[language].baseball.leaderboard
  // The visitor sees their own character on their own row, as they posted it, whatever the public sees.
  const name = own?.name ?? rowName(row, language)
  return (
    <li className="board-row" value={row.rank} data-mine={own ? '' : undefined}>
      <span className="board-row-rank">{row.rank}</span>
      <Portrait profile={own ? own.profile : row.profile} className="board-portrait" />
      <span className="board-row-name">
        <span data-placeholder={(!own && row.nameState !== 'approved') || undefined}>{name}</span>
        {own && <span className="board-mine">{copy.mine}</span>}
      </span>
      <span className="board-row-home-runs">{copy.homeRuns(row.homeRuns)}</span>
      <span className="board-row-distance">{homeRunDistanceText(row.totalDistanceDm, language, 1)}</span>
      <RecordMenu row={row} name={rowName(row, language)} contactEmail={contactEmail} language={language} />
    </li>
  )
}

/** The visitor's own record on this board, kept in this browser only, with what they can do with it. */
export function OwnRecordCard({
  own,
  final,
  month,
  language,
  onOpen,
  onUnlist,
}: {
  own: BoardOwnEntry | null
  final: boolean
  month: string
  language: AppLanguage
  onOpen: () => void
  onUnlist: () => Promise<void>
}) {
  const copy = languageCopy[language].baseball
  const boardCopy = copy.leaderboard
  const [busy, setBusy] = useState(false)
  if (!own && final) return null
  if (!own)
    return (
      <section className="board-own" data-kind="none" aria-labelledby="board-own-title">
        <div>
          <h2 id="board-own-title">{copy.board.ownTitle}</h2>
          <p className="board-own-title">{boardCopy.ownNone}</p>
        </div>
        <div className="board-own-actions">
          <a className="primary-button compact" href={BASEBALL_PATH}>
            {boardCopy.challenge}
          </a>
        </div>
      </section>
    )
  const unlist = async () => {
    setBusy(true)
    await onUnlist()
    setBusy(false)
  }
  return (
    <section className="board-own" data-kind={own.listed ? 'listed' : 'unlisted'} aria-labelledby="board-own-title">
      <Portrait profile={own.profile} className="board-portrait board-own-portrait" />
      <div>
        <h2 id="board-own-title">{copy.board.ownTitle}</h2>
        <p className="board-own-title">{ownHeadline(own, final, month, language)}</p>
        <p className="board-own-detail">
          {[own.name, recordText(own.homeRuns, own.totalDistanceDm, language)].filter(Boolean).join(' · ')}
        </p>
        {own.listed && own.nameStatus && own.nameStatus !== 'approved' && (
          <p className="board-own-status">{copy.board.nameStatus[own.nameStatus]}</p>
        )}
        {own.linkedIn && (
          <p className="board-own-status">
            {own.linkedIn.profileHint} · {linkedInStatusText(own.linkedIn.status, language)}
            {own.linkedIn.status !== 'approved' && <code> {own.linkedIn.code}</code>}
          </p>
        )}
        <p className="board-own-status">{boardCopy.ownBrowserOnly}</p>
      </div>
      {!final && own.rank !== null && (
        <div className="board-own-actions">
          {own.listed ? (
            <>
              <button className="derby-secondary" type="button" onClick={onOpen}>
                {boardCopy.change}
              </button>
              <button className="derby-secondary" type="button" disabled={busy} onClick={unlist}>
                {boardCopy.unlist}
              </button>
            </>
          ) : (
            <button className="primary-button compact" type="button" onClick={onOpen}>
              {copy.board.list}
            </button>
          )}
        </div>
      )}
    </section>
  )
}

/** Last month's champions under an empty month's pedestals, with the way to their final board. */
export function LastSeasonStrip({
  board,
  currentSeason,
  language,
  onSeason,
}: {
  board: Board
  currentSeason: string
  language: AppLanguage
  onSeason: (season: string) => void
}) {
  const copy = languageCopy[language].baseball.leaderboard
  return (
    <div className="board-last-season">
      <button type="button" className="board-last-season-title" onClick={() => onSeason(board.season.id)}>
        {copy.lastSeason(monthName(board.season.id, currentSeason, language))} <span aria-hidden="true">›</span>
      </button>
      <ol>
        {board.podium.map((row) => (
          <li key={row.id} value={row.rank}>
            <span className="board-medal" data-rank={row.rank} aria-hidden="true">
              {row.rank}
            </span>
            <Portrait profile={row.profile} className="board-portrait" />
            <span>
              <b>{rowName(row, language)}</b>
              <span>{recordText(row.homeRuns, row.totalDistanceDm, language)}</span>
            </span>
          </li>
        ))}
      </ol>
    </div>
  )
}
