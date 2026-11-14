import { type ReactNode, useCallback, useEffect, useMemo, useState } from 'react'
import {
  effectiveBallparkRules,
  nextRankingWeek,
  previousRankingWeek,
  rankingWeek,
  seasonEndsAt,
  upcomingBallparkRules,
} from '../../data/ballparkRules'
import { homeRunDistanceText, linkedInChipText, recordText, rowName } from '../../data/boardRecord'
import {
  type Board,
  type BoardOwnEntry,
  type BoardRow,
  type BoardSeason,
  deleteOwnRecords,
  forgetVisitor,
  type ListingChoice,
  reportBoardEntry,
  type ReportReason,
  type ReportTarget,
  turnOffLinkedIn,
  updateOwnRecord,
} from '../../data/leaderboardApi'
import type { TownSnapshot } from '../../data/models'
import type { PlayerProfile } from '../../data/playerProfile'
import { clearStoredSession, getBrowserSessionStore, readStoredSession } from '../../data/visitorSession'
import { usePageLanguage } from '../../hooks/usePageLanguage'
import { useReducedMotion } from '../../hooks/useReducedMotion'
import { type AppLanguage, languageCopy, weekName } from '../../i18n/language'
import { copyText } from '../../scene/webglSupport'
import { STATUE_RANKS, type StatueRank } from '../../scene/statues/statueFinishes'
import { LanguageSelect } from '../../ui/LanguageSelect'
import { PrivacyLink } from '../../ui/PrivacyLink'
import { BASEBALL_PATH, BOARD_PATH, HALL_OF_FAME_PATH } from '../baseballRoute'
import { ConfirmedAction, DeleteOwnRecords, ListingView, OwnLinkedIn } from '../ui/ListingView'
import { BoardPodium } from './BoardPodium'
import { daysUntilSeasonEnds, linkedInReturn, oldestShownSeason, requestedSeason, seasonSearch } from './boardSeason'
import {
  hasSeenReveal,
  isOwnRow,
  listingBatter,
  noteRevealSeen,
  ownHeadline,
  recordNumber,
  seasonResetText,
  statueLooks,
  takedownHref,
} from './boardView'
import { OwnPastSeasons } from './OwnPastSeasons'
import { usePortrait } from './portraitImages'
import { useBoard } from './useBoard'
import '../baseball.css'
import './board.css'

/**
 * The weekly board at /baseball/ranking (`?season=YYYY-MM-DD` for a past week's final board): the top three as painted
 * statues over their name plates, places 4 to 50 as a list, and the visitor's own record between them, which they
 * can post, take off, or change here, with its LinkedIn link. The statues rise third to first the first time this
 * browser sees a week's board. A LinkedIn link shows only on a statue, once its visitor signed in with LinkedIn; that
 * sign-in returns the browser here with `?linkedin=verified` or `?linkedin=failed`, which the page says in a line and
 * takes out of the address. Phones may read it too.
 */
export function BoardPage({ town }: { town: TownSnapshot }) {
  const [language, setLanguage] = usePageLanguage()
  const copy = languageCopy[language].baseball.leaderboard
  const [currentSeason] = useState(() => rankingWeek(new Date()))
  const [season, setSeason] = useState(() => requestedSeason(window.location.search, currentSeason))
  const { load, reload } = useBoard(season)
  const contactEmail = town.owner.contactEmail
  // Read once as the page loads, which is also when the board is read, so the record already shows the outcome.
  const [signedIn] = useState(() => linkedInReturn(window.location.search))

  useEffect(() => {
    if (signedIn) window.history.replaceState(null, '', `${BOARD_PATH}${seasonSearch(season)}`)
  }, [signedIn, season])

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
      {/* The board keeps names, characters, and statues' links with no end date; nginx sends X-Robots-Tag too. */}
      <meta name="robots" content="noindex, noarchive" />
      <div className="board-column">
        <BoardTopline
          backHref={BASEBALL_PATH}
          backLabel={copy.back}
          running={Boolean(contactEmail)}
          language={language}
          onLanguage={setLanguage}
        />
        <SeasonHeading
          town={town}
          season={shownSeason}
          currentSeason={currentSeason}
          language={language}
          onSeason={(next) => goTo(next === currentSeason ? null : next)}
        />
        {signedIn && (
          <p className="board-notice" role="status" data-outcome={signedIn}>
            {copy.linkedInReturn[signedIn]}
          </p>
        )}
        {!contactEmail && <p className="board-state">{copy.notRunning}</p>}
        {contactEmail && load.status === 'loading' && <BoardLoading />}
        {contactEmail && load.status === 'failed' && <BoardLoadFailed language={language} onRetry={reload} />}
        {contactEmail && load.status === 'ready' && (
          <BoardSections
            key={load.board.season.id}
            board={load.board}
            lastSeason={load.lastSeason}
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

/** The way back, the language, and while the board runs the way to play. */
export function BoardTopline({
  backHref,
  backLabel,
  running,
  language,
  onLanguage,
}: {
  backHref: string
  backLabel: string
  running: boolean
  language: AppLanguage
  onLanguage: (language: AppLanguage) => void
}) {
  return (
    <nav className="board-topline">
      <a className="baseball-back" href={backHref}>
        <span aria-hidden="true">‹</span> {backLabel}
      </a>
      <div className="board-topline-actions">
        <LanguageSelect language={language} className="baseball-language-select" onChange={onLanguage} />
        {running && (
          <a className="primary-button compact" href={BASEBALL_PATH}>
            {languageCopy[language].baseball.leaderboard.challenge}
          </a>
        )}
      </div>
    </nav>
  )
}

export function BoardLoading() {
  return (
    <div className="board-state" aria-busy="true">
      <span className="loader" aria-hidden="true" />
    </div>
  )
}

export function BoardLoadFailed({ language, onRetry }: { language: AppLanguage; onRetry: () => void }) {
  const copy = languageCopy[language].baseball
  return (
    <div className="board-state" role="alert">
      <p>{copy.leaderboard.loadFailed}</p>
      <button className="primary-button compact" type="button" onClick={onRetry}>
        {copy.board.retry}
      </button>
    </div>
  )
}

/** The title, the season and the buttons to the others, and for this week when it ends and the rules it plays. */
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
  const week = weekName(season, currentSeason, language)
  const current = season === currentSeason
  const endsAt = current ? seasonEndsAt(season) : null
  const rules = effectiveBallparkRules(ballpark, currentSeason)
  const upcoming = upcomingBallparkRules(ballpark, currentSeason)
  return (
    <header className="board-heading">
      <p className="eyebrow">{boardCopy.eyebrow(venueCopy.themes[ballpark.theme])}</p>
      <div className="board-title-row">
        <h1>{current ? boardCopy.title : boardCopy.finalTitle(week)}</h1>
        <div className="board-season">
          <button
            type="button"
            className="board-season-step"
            aria-label={boardCopy.previousSeason}
            disabled={season <= oldestShownSeason(currentSeason)}
            onClick={() => onSeason(previousRankingWeek(season))}
          >
            ‹
          </button>
          <p className="board-season-pill">
            <b>{boardCopy.season(week)}</b>
            <span aria-hidden="true">·</span>
            <span>{endsAt ? boardCopy.daysLeft(daysUntilSeasonEnds(endsAt, now)) : boardCopy.seasonOver}</span>
          </p>
          <button
            type="button"
            className="board-season-step"
            aria-label={boardCopy.nextSeason}
            disabled={current}
            onClick={() => onSeason(nextRankingWeek(season))}
          >
            ›
          </button>
        </div>
      </div>
      {current && (
        <p className="board-meta">
          {endsAt && <span>{seasonResetText(endsAt, language)}</span>}
          <span>{venueCopy.rulesThisWeek(rules.pitchCount, venueCopy.difficulties[rules.difficulty])}</span>
          {upcoming && (
            <span>
              {venueCopy.rulesFrom(
                weekName(upcoming.fromWeek, currentSeason, language),
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
  contactEmail,
  currentSeason,
  language,
  onReload,
  onSeason,
}: {
  board: Board
  lastSeason: Board | null
  contactEmail: string
  currentSeason: string
  language: AppLanguage
  onReload: () => void
  onSeason: (season: string) => void
}) {
  const copy = languageCopy[language].baseball.leaderboard
  const reducedMotion = useReducedMotion()
  const { season, podium, ranks, own, linkedInAvailable } = board
  const week = weekName(season.id, currentSeason, language)
  const emptyWeek = !season.final && podium.length === 0
  const [revealing, setRevealing] = useState(() => !season.final && podium.length > 0 && !hasSeenReveal(season.id))
  const [shownPlates, setShownPlates] = useState<ReadonlySet<StatueRank>>(() => new Set(revealing ? [] : STATUE_RANKS))
  const [listing, setListing] = useState(false)
  const [pastSeasonsRead, setPastSeasonsRead] = useState(0)
  const looks = useMemo(() => statueLooks(podium), [podium])
  // The open list of past statues reads for itself, so a change made outside it has to send it back to the server.
  const reloadWithPastSeasons = () => {
    setPastSeasonsRead((current) => current + 1)
    onReload()
  }

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
  const sessionProfile = useMemo(() => readStoredSession(getBrowserSessionStore())?.profile ?? null, [])

  return (
    <>
      <section className="board-podium" aria-labelledby="board-statues-title" data-empty={emptyWeek || undefined}>
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
          {emptyWeek && (
            <div className="board-empty-banner">
              <p>
                <b>{copy.emptyWeek}</b>
              </p>
              <p>{copy.emptyWeekHint}</p>
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
              finalWeek={season.final ? week : null}
              shown={shownPlates.has(rank) || reducedMotion}
              challenge={!season.final && !emptyWeek}
              season={season.id}
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
        season={season}
        week={week}
        linkedInAvailable={linkedInAvailable}
        language={language}
        onOpen={() => setListing(true)}
        onUnlist={async () => {
          await updateOwnRecord({ listed: false })
          onReload()
        }}
        onLinkedInOff={async () => {
          await turnOffLinkedIn(season.id)
          reloadWithPastSeasons()
        }}
      >
        <OwnPastSeasons
          currentSeason={currentSeason}
          language={language}
          revision={pastSeasonsRead}
          onChanged={onReload}
        />
      </OwnRecordCard>
      <section className="board-list-card" aria-labelledby="board-list-title">
        <div className="board-list-head">
          <h2 id="board-list-title">{season.final ? copy.finalListTitle(week) : copy.listTitle}</h2>
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
                  season={season.id}
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
        <a className="board-hall-link" href={HALL_OF_FAME_PATH}>
          {copy.hallOfFameLink} <span aria-hidden="true">›</span>
        </a>
      </section>
      <footer className="board-footer">
        <BoardNoticeLinks contactEmail={contactEmail} language={language} />
        <DeleteOwnRecords
          language={language}
          onDelete={async () => {
            await deleteOwnRecords()
            reloadWithPastSeasons()
          }}
        />
        <ConfirmedAction
          label={copy.nextPlayer}
          confirmText={copy.nextPlayerConfirm}
          confirmLabel={copy.nextPlayerConfirmAction}
          keepLabel={copy.nextPlayerKeep}
          failedText={copy.nextPlayerFailed}
          onConfirm={async () => {
            await forgetVisitor()
            // The character this tab plays as holds the name and link too, which the next person must not inherit.
            clearStoredSession(getBrowserSessionStore())
            window.location.reload()
          }}
        />
      </footer>
      {listing && own && !season.final && (
        <div className="board-dialog" role="dialog" aria-modal="true" aria-labelledby="derby-listing-title">
          <ListingView
            entry={own}
            batter={listingBatter(own, sessionProfile)}
            name={own.name ?? sessionProfile?.name ?? null}
            linkedInAvailable={linkedInAvailable}
            language={language}
            onSave={async (choice: ListingChoice) => {
              await updateOwnRecord(choice)
              onReload()
            }}
            onLinkedInOff={async () => {
              await turnOffLinkedIn(null)
              onReload()
            }}
            onDelete={async () => {
              await deleteOwnRecords()
              setListing(false)
              reloadWithPastSeasons()
            }}
            onClose={() => setListing(false)}
          />
        </div>
      )}
    </>
  )
}

/** How to ask for a record's removal, and the privacy notice: the foot of the board and of the hall of fame. */
export function BoardNoticeLinks({ contactEmail, language }: { contactEmail: string; language: AppLanguage }) {
  const copy = languageCopy[language].baseball.leaderboard
  return (
    <>
      <a href={takedownHref(contactEmail, copy.takedown)}>{copy.takedown}</a>
      <span aria-hidden="true"> · </span>
      <PrivacyLink language={language} />
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

/** A statue's name plate: its place, the plaque's words, the name, the record, and a LinkedIn chip if verified. */
export function BoardPlate({
  rank,
  row,
  finalWeek,
  shown,
  challenge,
  season,
  contactEmail,
  language,
}: {
  rank: StatueRank
  row: BoardRow | null
  finalWeek: string | null
  shown: boolean
  challenge: boolean
  season: string
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
      <p className="board-plate-label">{finalWeek ? copy.plaqueFinal(finalWeek, rank) : copy.plaqueLive(rank)}</p>
      <p className="board-plate-name" data-placeholder={row.nameState !== 'shown' || undefined}>
        {name}
      </p>
      <p className="board-plate-record">{recordText(row.homeRuns, row.totalDistanceDm, language)}</p>
      <div className="board-plate-link">
        {row.linkedInProfileUrl && (
          <StatueLinkedIn profileUrl={row.linkedInProfileUrl} name={name} language={language} />
        )}
        <RecordMenu row={row} name={name} season={season} contactEmail={contactEmail} language={language} />
      </div>
    </li>
  )
}

/** A statue's verified LinkedIn link: a chip that says where it leads. */
export function StatueLinkedIn({
  profileUrl,
  name,
  language,
}: {
  profileUrl: string
  name: string
  language: AppLanguage
}) {
  return (
    <a
      className="board-linkedin"
      href={profileUrl}
      target="_blank"
      rel="ugc nofollow noopener noreferrer"
      aria-label={languageCopy[language].baseball.leaderboard.linkedInLabel(name)}
    >
      <span className="board-linkedin-icon" aria-hidden="true">
        in
      </span>
      <span className="board-linkedin-handle">{linkedInChipText(profileUrl)}</span>
      <span aria-hidden="true">↗</span>
    </a>
  )
}

/**
 * A record's [⋯]: report its name, character, or link, copy its number, or ask for its removal by mail. A report is
 * answered the same whatever the board did with it, so the page says the same too.
 */
export function RecordMenu({
  row,
  name,
  season,
  contactEmail,
  language,
}: {
  row: BoardRow
  name: string
  season: string
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
        {row.nameState === 'shown' && (
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
        <a href={takedownHref(contactEmail, copy.takedownSubject(number, season))}>{copy.takedown}</a>
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
  season,
  contactEmail,
  language,
}: {
  row: BoardRow
  own: BoardOwnEntry | null
  season: string
  contactEmail: string
  language: AppLanguage
}) {
  const copy = languageCopy[language].baseball.leaderboard
  // The visitor sees their own character on their own row, as they posted it, whatever the public sees, until a
  // takedown hides it from everyone.
  const name = own?.name ?? rowName(row, language)
  return (
    <li className="board-row" value={row.rank} data-mine={own ? '' : undefined}>
      <span className="board-row-rank">{row.rank}</span>
      <Portrait profile={own && !own.takedown ? own.profile : row.profile} className="board-portrait" />
      <span className="board-row-name">
        <span data-placeholder={(!own && row.nameState !== 'shown') || undefined}>{name}</span>
        {own && <span className="board-mine">{copy.mine}</span>}
      </span>
      <span className="board-row-home-runs">{copy.homeRuns(row.homeRuns)}</span>
      <span className="board-row-distance">{homeRunDistanceText(row.totalDistanceDm, language, 1)}</span>
      <RecordMenu
        row={row}
        name={rowName(row, language)}
        season={season}
        contactEmail={contactEmail}
        language={language}
      />
    </li>
  )
}

/**
 * The visitor's own record on this board, kept in this browser only, with what they can do with it: this week's
 * record is posted or taken off the board, or changed; and wherever the record has a LinkedIn link (a past season's or
 * a removed record's too) they can sign in with LinkedIn to show it, or remove it. A change the board did not take
 * says so. Deleting every record sits in the page's footer.
 */
export function OwnRecordCard({
  own,
  season,
  week,
  linkedInAvailable,
  language,
  onOpen,
  onUnlist,
  onLinkedInOff,
  children,
}: {
  own: BoardOwnEntry | null
  season: BoardSeason
  week: string
  linkedInAvailable: boolean
  language: AppLanguage
  onOpen: () => void
  onUnlist: () => Promise<void>
  onLinkedInOff: () => Promise<void>
  /** The visitor's past seasons, along the card's foot. */
  children: ReactNode
}) {
  const copy = languageCopy[language].baseball
  const boardCopy = copy.leaderboard
  const [busy, setBusy] = useState(false)
  const [failed, setFailed] = useState(false)
  const { final } = season
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
        {children}
      </section>
    )
  const unlist = async () => {
    setBusy(true)
    setFailed(false)
    await onUnlist().catch(() => setFailed(true))
    setBusy(false)
  }
  const changeable = !final && own.rank !== null && !own.takedown
  return (
    <section className="board-own" data-kind={own.listed ? 'listed' : 'unlisted'} aria-labelledby="board-own-title">
      <Portrait profile={own.takedown ? null : own.profile} className="board-portrait board-own-portrait" />
      <div>
        <h2 id="board-own-title">{copy.board.ownTitle}</h2>
        <p className="board-own-title">{ownHeadline(own, final, week, language)}</p>
        <p className="board-own-detail">
          {[own.name, recordText(own.homeRuns, own.totalDistanceDm, language)].filter(Boolean).join(' · ')}
        </p>
        {own.listed && own.nameStatus === 'rejected' && <p className="board-own-status">{copy.board.nameRejected}</p>}
        {own.linkedIn && (
          <OwnLinkedIn
            linkedIn={own.linkedIn}
            available={linkedInAvailable}
            season={final ? season.id : null}
            language={language}
            onRemove={onLinkedInOff}
          />
        )}
        <p className="board-own-status">{boardCopy.ownBrowserOnly}</p>
        {failed && (
          <p className="board-own-status" role="alert">
            {copy.board.problems.saveFailed}
          </p>
        )}
      </div>
      {changeable && (
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
      {children}
    </section>
  )
}

/** Last week's champions under an empty week's pedestals, with the way to their final board. */
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
        {copy.lastSeason(weekName(board.season.id, currentSeason, language))} <span aria-hidden="true">›</span>
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
