import { useCallback, useState } from 'react'
import { recordNumber } from '../baseball/board/boardView'
import { usePortrait } from '../baseball/board/portraitImages'
import { rankingMonth } from '../data/ballparkRules'
import { distanceText, recordText } from '../data/boardRecord'
import {
  acceptHeldRun,
  dismissHeldRun,
  dismissRunsWithoutHistory,
  fetchBoardReview,
  fetchReviewedRun,
  sendRecordAction,
  type BoardReviewData,
  type RecordAction,
  type ReviewedEntry,
  type ReviewedLink,
  type ReviewedPitch,
  type ReviewedRun,
  type ReviewItem,
  type ReviewReport,
} from '../data/boardReviewApi'
import type { PlayerProfile } from '../data/playerProfile'
import { useRetryableLoad } from '../hooks/useRetryableLoad'
import type { AppLanguage } from '../i18n/language'
import { languageCopy, monthName } from '../i18n/language'
import { CloseButton } from '../ui/CloseButton'
import './boardReview.css'
import { boardReviewCopy, type BoardReviewCopy } from './boardReviewCopy'
import {
  actionQuestion,
  findRecords,
  flagLabel,
  foundItem,
  isPickableSeason,
  isStaleBoardReview,
  itemKey,
  linkView,
  neighbourLines,
  noHistoryRuns,
  numberText,
  recordButtons,
  recordChoices,
  reviewGroups,
  reviewTime,
  warningText,
  withEntry,
  withoutRun,
} from './boardReviewing'

/** How the dialog's data changes once an action is answered, and what to tell the admin if not the usual. */
type ActionOutcome = { change: (data: BoardReviewData) => BoardReviewData; notice?: string }
type CardActions = {
  onRecordAction: (entry: ReviewedEntry, action: RecordAction) => void
  onAcceptRun: (run: ReviewedRun) => void
  onDismissRun: (run: ReviewedRun) => void
}

const buttonClasses = {
  primary: 'primary-button editor-primary',
  plain: 'text-button',
  danger: 'text-button danger',
}

export function Portrait({ profile, label }: { profile: PlayerProfile; label: string }) {
  const source = usePortrait(profile)
  return source ? (
    <img className="board-review-portrait" src={source} alt={label} width={72} height={72} />
  ) : (
    <span className="board-review-portrait" role="img" aria-label={label} />
  )
}

/** The link as what it really reads: decoded and large, with the encoded address beside it when it was encoded. */
export function PublicLink({ link, copy }: { link: ReviewedLink; copy: BoardReviewCopy }) {
  const view = linkView(link)
  return (
    <div className="board-review-link">
      <strong className="board-review-link-id">{view.text}</strong>
      {view.encoded && <span className="board-review-mark is-warning">{copy.linkEncoded}</span>}
      {view.encoded && <code className="board-review-raw">{link.profileUrl}</code>}
      <span className="board-review-marks">
        <span className="board-review-mark">{copy.linkStatuses[link.status]}</span>
        <span className="board-review-mark">{copy.linkCode(link.code)}</span>
        {view.href && (
          <a href={view.href} target="_blank" rel="noopener noreferrer">
            {copy.openProfile}
          </a>
        )}
      </span>
    </div>
  )
}

export function PublicPreview({
  name,
  profile,
  link,
  copy,
}: {
  name: string | null
  profile: PlayerProfile | null
  link: ReviewedLink | null
  copy: BoardReviewCopy
}) {
  return (
    <div className="board-review-public">
      {profile && <Portrait profile={profile} label={copy.portraitLabel} />}
      <div className="board-review-public-text">
        <span className="board-review-label">{copy.publicTitle}</span>
        <strong className="board-review-name">
          <bdi>{name ?? copy.noName}</bdi>
        </strong>
        {link && <PublicLink link={link} copy={copy} />}
      </div>
    </div>
  )
}

export function PitchTable({
  pitches,
  language,
  copy,
}: {
  pitches: readonly ReviewedPitch[]
  language: AppLanguage
  copy: BoardReviewCopy
}) {
  const outcomes = languageCopy[language].baseball.result.outcomes
  return (
    <div className="board-review-table">
      <table>
        <thead>
          <tr>
            <th scope="col">{copy.pitch.number}</th>
            <th scope="col">{copy.pitch.type}</th>
            <th scope="col">{copy.pitch.error}</th>
            <th scope="col">{copy.pitch.power}</th>
            <th scope="col">{copy.pitch.swing}</th>
            <th scope="col">{copy.pitch.height}</th>
            <th scope="col">{copy.pitch.speed}</th>
            <th scope="col">{copy.pitch.outcome}</th>
            <th scope="col">{copy.pitch.distance}</th>
          </tr>
        </thead>
        <tbody>
          {pitches.map((pitch, index) => (
            <tr key={index}>
              <td>{index + 1}</td>
              <td>{copy.pitchTypes[pitch.pitchType]}</td>
              <td>{numberText(pitch.errorMs, 1)}</td>
              <td>{numberText(pitch.power, 2)}</td>
              <td>{numberText(pitch.swingDurationMs, 0)}</td>
              <td>{numberText(pitch.heightError, 2)}</td>
              <td>{numberText(pitch.swingSpeed, 1)}</td>
              <td>{outcomes[pitch.outcome]}</td>
              <td>{pitch.distanceDm === null ? '—' : distanceText(pitch.distanceDm, language, 1)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

/** What the server worked out for a run: its flags, its clocks, its practice, and every pitch. */
export function RunFacts({ run, language, copy }: { run: ReviewedRun; language: AppLanguage; copy: BoardReviewCopy }) {
  const result = run.result
  return (
    <>
      <p className="board-review-marks">
        {run.flags.length === 0 && <span className="board-review-mark">{copy.noFlags}</span>}
        {run.flags.map((flag) => (
          <span className="board-review-mark is-warning" key={flag}>
            {flagLabel(flag, copy)}
          </span>
        ))}
      </p>
      {result && (
        <dl className="board-review-facts">
          <div>
            <dt>{copy.facts.claimed}</dt>
            <dd>{recordText(result.claimed.homeRuns, result.claimed.totalDistanceDm, language)}</dd>
          </div>
          <div>
            <dt>{copy.facts.scored}</dt>
            <dd>{recordText(result.homeRuns, result.totalDistanceDm, language)}</dd>
          </div>
          <div>
            <dt>{copy.facts.serverElapsed}</dt>
            <dd>{numberText(result.serverElapsedMs, 0)} ms</dd>
          </div>
          <div>
            <dt>{copy.facts.clientElapsed}</dt>
            <dd>{numberText(result.clientElapsedMs, 0)} ms</dd>
          </div>
          <div>
            <dt>{copy.facts.offset}</dt>
            <dd>{numberText(result.calibration.offsetMs, 1)} ms</dd>
          </div>
          <div>
            <dt>{copy.facts.peakSpeed}</dt>
            <dd>{numberText(result.calibration.peakSpeed, 1)}</dd>
          </div>
          <div>
            <dt>{copy.facts.practiceMedian}</dt>
            <dd>{numberText(result.practiceMedianMs, 1)} ms</dd>
          </div>
          <div>
            <dt>{copy.facts.practiceSpeeds}</dt>
            <dd>{result.practiceSpeeds.map((speed) => numberText(speed, 1)).join(', ') || '—'}</dd>
          </div>
        </dl>
      )}
      {result && <PitchTable pitches={result.pitches} language={language} copy={copy} />}
    </>
  )
}

export function HeldRun({
  run,
  item,
  language,
  copy,
  busy,
  onAcceptRun,
  onDismissRun,
}: {
  run: ReviewedRun
  item: ReviewItem
  language: AppLanguage
  copy: BoardReviewCopy
  busy: boolean
} & Pick<CardActions, 'onAcceptRun' | 'onDismissRun'>) {
  // Accepting a run posts what it was sent with, which the card's preview already shows for a visitor with no record.
  const sentShown = item.entry === null && run === item.runs[0]
  return (
    <div className="board-review-run">
      <strong>{run.wouldBeRank === null ? copy.heldRun : copy.heldRunPlace(run.wouldBeRank)}</strong>
      {!sentShown && (
        <p className="editor-note">
          <bdi>{copy.sentAs(run.name ?? copy.noName)}</bdi>
        </p>
      )}
      {!sentShown && run.profile && <Portrait profile={run.profile} label={copy.runPortraitLabel} />}
      {run.submittedAt && <time dateTime={run.submittedAt}>{reviewTime(run.submittedAt, language)}</time>}
      <RunFacts run={run} language={language} copy={copy} />
      <div className="editor-actions">
        <button className="text-button" type="button" disabled={busy} onClick={() => onAcceptRun(run)}>
          {copy.acceptRun}
        </button>
        <button className="text-button danger" type="button" disabled={busy} onClick={() => onDismissRun(run)}>
          {copy.dismissRun}
        </button>
      </div>
    </div>
  )
}

export function LoadedRun({ runId, language, copy }: { runId: string; language: AppLanguage; copy: BoardReviewCopy }) {
  const load = useCallback(() => fetchReviewedRun(runId), [runId])
  const { status, latest, retry } = useRetryableLoad(load)
  if (status === 'loading') return <p role="status">{copy.loading}</p>
  if (status === 'error' || !latest) {
    return (
      <p role="alert">
        {copy.runLoadError}{' '}
        <button className="text-button" type="button" onClick={retry}>
          {copy.retry}
        </button>
      </p>
    )
  }
  return <RunFacts run={latest} language={language} copy={copy} />
}

/**
 * A record's own run has scored, so the queue does not bring it; it loads when opened. Without one (its run was
 * deleted), the record's copied public result is all there is.
 */
export function RecordRun({
  entry,
  language,
  copy,
}: {
  entry: ReviewedEntry
  language: AppLanguage
  copy: BoardReviewCopy
}) {
  const [opened, setOpened] = useState(false)
  if (!entry.bestRunId) return <PitchTable pitches={entry.pitches} language={language} copy={copy} />
  return (
    <details className="board-review-best" onToggle={(event) => setOpened(event.currentTarget.open)}>
      <summary>{copy.recordRun}</summary>
      {opened && <LoadedRun runId={entry.bestRunId} language={language} copy={copy} />}
    </details>
  )
}

export function ReportLine({
  report,
  language,
  copy,
  busy,
  onResolve,
}: {
  report: ReviewReport
  language: AppLanguage
  copy: BoardReviewCopy
  busy: boolean
  onResolve: (resolution: 'kept' | 'removed') => void
}) {
  return (
    <li>
      <span>
        {copy.reportLine(copy.reportTargets[report.target], report.count)}{' '}
        <time dateTime={report.lastReportedAt}>{reviewTime(report.lastReportedAt, language)}</time>
      </span>
      {report.mine && <span className="board-review-mark is-warning">{copy.reportMine}</span>}
      <span className="editor-actions">
        <button className="text-button" type="button" disabled={busy} onClick={() => onResolve('kept')}>
          {copy.resolutions[report.target].kept}
        </button>
        <button className="text-button danger" type="button" disabled={busy} onClick={() => onResolve('removed')}>
          {copy.resolutions[report.target].removed}
        </button>
      </span>
    </li>
  )
}

export function RecordActions({
  entry,
  copy,
  busy,
  onAction,
}: {
  entry: ReviewedEntry
  copy: BoardReviewCopy
  busy: boolean
  onAction: (action: RecordAction) => void
}) {
  const [blockLinkedIn, setBlockLinkedIn] = useState(false)
  const blocking = blockLinkedIn && entry.linkedIn !== null
  return (
    <div className="board-review-actions">
      <div className="editor-actions">
        {recordButtons(entry, copy).map(({ label, action, tone }) => (
          <button
            key={label}
            className={buttonClasses[tone]}
            type="button"
            disabled={busy}
            onClick={() => onAction(action)}
          >
            {label}
          </button>
        ))}
      </div>
      {recordChoices(entry).takedown && (
        <div className="editor-actions">
          <button
            className="text-button danger"
            type="button"
            disabled={busy}
            onClick={() => onAction(blocking ? { kind: 'takedown', blockLinkedIn: true } : { kind: 'takedown' })}
          >
            {copy.takedown}
          </button>
          {entry.linkedIn && (
            <label className="board-review-check">
              <input
                type="checkbox"
                checked={blockLinkedIn}
                disabled={busy}
                onChange={(event) => setBlockLinkedIn(event.target.checked)}
              />
              {copy.blockLinkedIn}
            </label>
          )}
        </div>
      )}
    </div>
  )
}

export function RecordMarks({
  entry,
  newVisitor,
  copy,
}: {
  entry: ReviewedEntry | null
  newVisitor: boolean
  copy: BoardReviewCopy
}) {
  return (
    <span className="board-review-marks">
      {newVisitor && <span className="board-review-mark is-warning">{copy.newVisitor}</span>}
      {entry && <span className="board-review-mark">{copy.reviewStatuses[entry.reviewStatus]}</span>}
      {entry?.nameStatus && <span className="board-review-mark">{copy.nameStatuses[entry.nameStatus]}</span>}
      {entry && !entry.listed && <span className="board-review-mark">{copy.unlisted}</span>}
      {entry?.takedown && <span className="board-review-mark">{copy.takenDown}</span>}
      {entry && !entry.appearancePublic && <span className="board-review-mark">{copy.appearanceHidden}</span>}
    </span>
  )
}

export function ReviewCard({
  item,
  language,
  currentSeason,
  copy,
  busy,
  onRecordAction,
  onAcceptRun,
  onDismissRun,
}: {
  item: ReviewItem
  language: AppLanguage
  currentSeason: string
  copy: BoardReviewCopy
  busy: boolean
} & CardActions) {
  const entry = item.entry
  const bestHeldRun = item.runs[0] ?? null
  const neighbours = entry && recordChoices(entry).approveName ? neighbourLines(item) : []
  return (
    <li className="guestbook-review-item board-review-item">
      <div>
        <strong>{monthName(item.season, currentSeason, language)}</strong>
        {entry && entry.rank !== null && (
          <span>
            {entry.listed && entry.reviewStatus !== 'disqualified' ? copy.place(entry.rank) : copy.wouldBe(entry.rank)}
          </span>
        )}
        {entry && <span>{recordText(entry.homeRuns, entry.totalDistanceDm, language)}</span>}
        {entry && <code className="board-review-raw">{copy.recordNumber(recordNumber(entry.id))}</code>}
        {entry && <time dateTime={entry.achievedAt}>{reviewTime(entry.achievedAt, language)}</time>}
        <RecordMarks entry={entry} newVisitor={item.newVisitor} copy={copy} />
      </div>
      <PublicPreview
        name={entry ? entry.name : (bestHeldRun?.name ?? null)}
        profile={entry?.profile ?? bestHeldRun?.profile ?? null}
        link={entry?.linkedIn ?? null}
        copy={copy}
      />
      {item.warnings.length > 0 && (
        <ul className="board-review-warnings">
          {item.warnings.map((warning, index) => (
            <li key={index}>
              <bdi>{warningText(warning, copy)}</bdi>
            </li>
          ))}
        </ul>
      )}
      {neighbours.length > 0 && (
        <div>
          <span className="board-review-label">{copy.neighbours}</span>
          <ol className="board-review-neighbours">
            {neighbours.map(({ rank, name, self }) => (
              <li key={rank} className={self ? 'is-self' : undefined}>
                {rank}. <bdi>{name ?? copy.noName}</bdi>
              </li>
            ))}
          </ol>
        </div>
      )}
      {item.visitor && <p className="editor-note">{copy.visitorCounts(item.visitor)}</p>}
      {item.reports.length > 0 && entry && (
        <ul className="board-review-reports">
          {item.reports.map((report) => (
            <ReportLine
              key={report.target}
              report={report}
              language={language}
              copy={copy}
              busy={busy}
              onResolve={(resolution) =>
                onRecordAction(entry, { kind: 'report-resolution', target: report.target, resolution })
              }
            />
          ))}
        </ul>
      )}
      {item.runs.map((run) => (
        <HeldRun
          key={run.id}
          run={run}
          item={item}
          language={language}
          copy={copy}
          busy={busy}
          onAcceptRun={onAcceptRun}
          onDismissRun={onDismissRun}
        />
      ))}
      {entry && <RecordRun entry={entry} language={language} copy={copy} />}
      {entry && (
        <RecordActions entry={entry} copy={copy} busy={busy} onAction={(action) => onRecordAction(entry, action)} />
      )}
    </li>
  )
}

/**
 * The admin's review of the derby's monthly boards: the server's queue, and a search for a record the queue does not
 * list, which is how a takedown request by mail gets handled. Every action names the version it read, so a record that
 * changed since is refused and the list reloads.
 */
export function BoardReview({ language, onClose }: { language: AppLanguage; onClose: () => void }) {
  const copy = boardReviewCopy[language]
  const shellCopy = languageCopy[language].boardReview
  const currentSeason = rankingMonth(new Date())
  const [season, setSeason] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const load = useCallback(() => fetchBoardReview(season), [season])
  const { status, latest, retry, update } = useRetryableLoad(load)
  const [busyKeys, setBusyKeys] = useState<ReadonlySet<string>>(new Set())
  const [failure, setFailure] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const queue = latest?.queue ?? []
  const groups = reviewGroups(queue)
  const dismissible = noHistoryRuns(queue)
  // A season still loading shows nothing of the one before it, so a search never acts on the wrong board.
  const seasonData = latest?.season === season ? latest : null
  const found = findRecords(seasonData?.records ?? [], query)

  /** Only the acting items wait; the list changes as `action` says at once, then reloads from the server. */
  const act = async (keys: readonly string[], action: () => Promise<ActionOutcome>) => {
    setBusyKeys((current) => new Set([...current, ...keys]))
    setFailure(null)
    setNotice(null)
    try {
      const outcome = await action()
      update(outcome.change)
      setNotice(outcome.notice ?? copy.done)
      retry()
    } catch (error) {
      reportFailure(error)
    } finally {
      setBusyKeys((current) => new Set([...current].filter((key) => !keys.includes(key))))
    }
  }
  const reportFailure = (error: unknown) => {
    setFailure(isStaleBoardReview(error) ? copy.changed : copy.failed)
    if (isStaleBoardReview(error)) retry()
  }
  const recordAction = (entry: ReviewedEntry, action: RecordAction) => {
    const question = actionQuestion(entry, action, copy)
    if (question && !window.confirm(question)) return
    void act([entry.id], async () => {
      const changed = await sendRecordAction(entry, action)
      return { change: (data) => withEntry(data, changed) }
    })
  }
  const acceptRun = (item: ReviewItem, run: ReviewedRun) =>
    void act([itemKey(item)], async () => {
      const entry = await acceptHeldRun(run, item.entry)
      return { change: (data) => withEntry(withoutRun(data, run.id), entry) }
    })
  const dismissRun = (item: ReviewItem, run: ReviewedRun) =>
    void act([itemKey(item)], async () => {
      await dismissHeldRun(run)
      return { change: (data) => withoutRun(data, run.id) }
    })
  const dismissNoHistory = ({ season: heldSeason, runs, keys }: (typeof dismissible)[number]) => {
    const month = monthName(heldSeason, currentSeason, language)
    if (!window.confirm(copy.bulkConfirm(month, runs))) return
    void act(keys, async () => {
      const dismissed = await dismissRunsWithoutHistory(heldSeason)
      return { change: (data) => data, notice: copy.bulkDone(dismissed) }
    })
  }
  const changeSeason = (value: string) => {
    if (!isPickableSeason(value, currentSeason)) return
    setSeason(value)
    retry()
  }
  const card = (item: ReviewItem) => (
    <ReviewCard
      key={`${item.season}:${itemKey(item)}`}
      item={item}
      language={language}
      currentSeason={currentSeason}
      copy={copy}
      busy={busyKeys.has(itemKey(item))}
      onRecordAction={recordAction}
      onAcceptRun={(run) => acceptRun(item, run)}
      onDismissRun={(run) => dismissRun(item, run)}
    />
  )

  return (
    <div
      className="panel-scrim guestbook-review-scrim"
      role="presentation"
      onMouseDown={(event) => event.target === event.currentTarget && onClose()}
    >
      <section
        className="guestbook-review board-review"
        role="dialog"
        aria-modal="true"
        aria-labelledby="board-review-title"
      >
        <CloseButton autoFocus onClick={onClose} label={shellCopy.close} />
        <h2 id="board-review-title">{shellCopy.title}</h2>
        <p className="editor-note">{copy.intro}</p>
        {failure && (
          <p className="editor-field-error" role="alert">
            {failure}
          </p>
        )}
        <p className="editor-note" role="status">
          {notice}
        </p>
        {status === 'error' && (
          <p role="alert">
            {copy.loadError}{' '}
            <button className="text-button" type="button" onClick={retry}>
              {copy.retry}
            </button>
          </p>
        )}
        {latest && latest.unreadable > 0 && <p role="alert">{copy.unreadable(latest.unreadable)}</p>}

        <section className="board-review-find" aria-labelledby="board-review-find-title">
          <h3 id="board-review-find-title">{copy.findTitle}</h3>
          <p className="editor-note">{copy.findNote}</p>
          <div className="board-review-find-fields">
            <label>
              {copy.season}
              <input
                type="month"
                defaultValue={currentSeason}
                max={currentSeason}
                onChange={(event) => changeSeason(event.target.value)}
              />
            </label>
            <label>
              {copy.query}
              <input type="search" value={query} onChange={(event) => setQuery(event.target.value)} />
            </label>
          </div>
          {query.trim() && !seasonData && status !== 'error' && <p role="status">{copy.loading}</p>}
          {query.trim() && seasonData && found.total === 0 && <p role="status">{copy.noMatch}</p>}
          {found.total > found.shown.length && <p role="status">{copy.moreMatches(found.shown.length, found.total)}</p>}
          {seasonData && found.shown.length > 0 && (
            <ul className="guestbook-review-list">
              {found.shown.map((record) => card(foundItem(record, seasonData)))}
            </ul>
          )}
        </section>

        {!latest && status === 'loading' && <p role="status">{copy.loading}</p>}
        {latest && queue.length === 0 && <p>{copy.empty}</p>}
        {dismissible.length > 0 && (
          <div className="editor-actions">
            {dismissible.map((held) => (
              <button
                key={held.season}
                className="text-button danger"
                type="button"
                disabled={held.keys.every((key) => busyKeys.has(key))}
                onClick={() => dismissNoHistory(held)}
              >
                {copy.bulkDismiss(monthName(held.season, currentSeason, language), held.runs)}
              </button>
            ))}
          </div>
        )}
        {groups.map(({ kind, items }) => (
          <section key={kind} className="board-review-group" aria-labelledby={`board-review-kind-${kind}`}>
            <h3 id={`board-review-kind-${kind}`}>
              {copy.kinds[kind]} <span className="board-review-count">{items.length}</span>
            </h3>
            <ul className="guestbook-review-list">{items.map(card)}</ul>
          </section>
        ))}
      </section>
    </div>
  )
}
