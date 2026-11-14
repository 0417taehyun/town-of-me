import { useCallback, useState } from 'react'
import { recordNumber } from '../baseball/board/boardView'
import { usePortrait } from '../baseball/board/portraitImages'
import { rankingWeek } from '../data/ballparkRules'
import { distanceText, recordText } from '../data/boardRecord'
import {
  fetchPlays,
  sendRecordAction,
  type PlayedLink,
  type PlayedPitch,
  type PlayedRecord,
  type PlayedRun,
  type PlayedRunResult,
  type PlayReport,
  type RecordAction,
} from '../data/boardReviewApi'
import type { PlayerProfile } from '../data/playerProfile'
import { useRetryableLoad } from '../hooks/useRetryableLoad'
import type { AppLanguage } from '../i18n/language'
import { languageCopy, weekName } from '../i18n/language'
import { CloseButton } from '../ui/CloseButton'
import './boardReview.css'
import { boardReviewCopy, type BoardReviewCopy } from './boardReviewCopy'
import {
  actionQuestion,
  flagLabel,
  flagNotes,
  isStaleBoardReview,
  linkView,
  numberText,
  pickedSeason,
  placeText,
  playRows,
  recordButtons,
  recordChoices,
  reviewTime,
  runScore,
  withLinkBlock,
  withNextPage,
  withRecord,
} from './boardReviewing'

type RecordActionHandler = (record: PlayedRecord, action: RecordAction) => void

export function Portrait({ profile, label }: { profile: PlayerProfile; label: string }) {
  const source = usePortrait(profile)
  return source ? (
    <img className="board-review-portrait" src={source} alt={label} width={56} height={56} />
  ) : (
    <span className="board-review-portrait" role="img" aria-label={label} />
  )
}

/**
 * The link as what it really reads, decoded, with the name of the LinkedIn account that signed in for it right under
 * it: the sign-in proves an account and not the address, so a mismatch between the two has to be seen.
 */
export function RecordLink({ link, copy }: { link: PlayedLink; copy: BoardReviewCopy }) {
  const view = linkView(link)
  return (
    <div className="board-review-link">
      <strong className="board-review-link-id">
        <bdi>{view.text}</bdi>
      </strong>
      {link.verifiedName && (
        <strong className="board-review-verified">
          <bdi>{copy.verifiedName(link.verifiedName)}</bdi>
        </strong>
      )}
      {link.verifiedName && <span className="board-review-raw">{copy.verifiedNameNote}</span>}
      {view.encoded && <code className="board-review-raw">{link.profileUrl}</code>}
      <span className="board-review-marks">
        <span className="board-review-mark">{copy.linkStatuses[link.status]}</span>
        {view.encoded && <span className="board-review-mark is-warning">{copy.linkEncoded}</span>}
        {view.href && (
          <a href={view.href} target="_blank" rel="noopener noreferrer">
            {copy.openProfile}
          </a>
        )}
      </span>
    </div>
  )
}

export function PitchTable({
  pitches,
  language,
  copy,
}: {
  pitches: readonly PlayedPitch[]
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

/** What the server worked out for a run: its clocks, its practice, and every pitch. */
export function RunFacts({
  result,
  language,
  copy,
}: {
  result: PlayedRunResult
  language: AppLanguage
  copy: BoardReviewCopy
}) {
  return (
    <>
      <dl className="board-review-facts">
        <div>
          <dt>{copy.facts.claimed}</dt>
          <dd>{recordText(result.claimed.homeRuns, result.claimed.totalDistanceDm, language)}</dd>
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
      <PitchTable pitches={result.pitches} language={language} copy={copy} />
    </>
  )
}

/** A run in one glance: when, its score, how far it got, and the server's marks; its pitches open on demand. */
export function RunSummary({ run, language, copy }: { run: PlayedRun; language: AppLanguage; copy: BoardReviewCopy }) {
  const score = runScore(run)
  return (
    <div className="board-review-run">
      <div className="board-review-line">
        <time dateTime={run.issuedAt}>{reviewTime(run.issuedAt, language)}</time>
        <strong>{score ? recordText(score.homeRuns, score.totalDistanceDm, language) : '—'}</strong>
        <code className="board-review-raw">{copy.visitor(run.visitor)}</code>
      </div>
      <p className="board-review-marks">
        <span className="board-review-mark">{copy.runStatuses[run.status]}</span>
        {run.best && <span className="board-review-mark">{copy.best}</span>}
        {run.flags.length === 0 && run.result && <span className="board-review-mark">{copy.noFlags}</span>}
        {run.flags.map((flag) => (
          <span className="board-review-mark is-warning" key={flag}>
            {flagLabel(flag, copy)}
          </span>
        ))}
      </p>
      {flagNotes(run.flags, copy).map((note) => (
        <p className="editor-note" key={note}>
          {note}
        </p>
      ))}
      {run.result && (
        <details>
          <summary>{copy.runDetail}</summary>
          <RunFacts result={run.result} language={language} copy={copy} />
        </details>
      )}
    </div>
  )
}

export function ReportLine({
  report,
  language,
  copy,
  busy,
  onResolve,
}: {
  report: PlayReport
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

/** A record's actions: removing it from the board is the one button; the rest are links, and a takedown comes last. */
export function RecordActions({
  record,
  copy,
  busy,
  onAction,
}: {
  record: PlayedRecord
  copy: BoardReviewCopy
  busy: boolean
  onAction: (action: RecordAction) => void
}) {
  const [blockLinkedIn, setBlockLinkedIn] = useState(false)
  const choices = recordChoices(record)
  const blocking = blockLinkedIn && record.linkedIn !== null
  return (
    <div className="board-review-actions">
      {choices.remove && (
        <button
          className="board-review-remove"
          type="button"
          disabled={busy}
          onClick={() => onAction({ kind: 'disqualification' })}
        >
          {copy.remove}
        </button>
      )}
      <div className="editor-actions">
        {recordButtons(record, copy).map(({ label, action }) => (
          <button
            key={label}
            className="text-button"
            type="button"
            disabled={busy}
            onClick={() => onAction(withLinkBlock(action, blocking))}
          >
            {label}
          </button>
        ))}
        {choices.takedown && (
          <button
            className="text-button danger"
            type="button"
            disabled={busy}
            onClick={() => onAction(withLinkBlock({ kind: 'takedown' }, blocking))}
          >
            {copy.takedown}
          </button>
        )}
      </div>
      {record.linkedIn && (
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
  )
}

/** A visitor's record: its place, whether it is posted, as whom, its link beside who signed in for it, and its reports. */
export function RecordCard({
  record,
  language,
  copy,
  busy,
  onAction,
}: {
  record: PlayedRecord
  language: AppLanguage
  copy: BoardReviewCopy
  busy: boolean
  onAction: RecordActionHandler
}) {
  return (
    <div className="board-review-record">
      {record.profile && <Portrait profile={record.profile} label={copy.portraitLabel} />}
      <div className="board-review-record-text">
        <div className="board-review-line">
          <strong>{placeText(record, copy)}</strong>
          <span>{recordText(record.homeRuns, record.totalDistanceDm, language)}</span>
          <code className="board-review-raw">{copy.recordNumber(recordNumber(record.id))}</code>
        </div>
        <strong className="board-review-name">
          <bdi>{record.name ?? copy.noName}</bdi>
        </strong>
        <span className="board-review-marks">
          {record.nameStatus === 'rejected' && <span className="board-review-mark">{copy.nameHidden}</span>}
          {record.takedown && <span className="board-review-mark">{copy.takenDown}</span>}
          {!record.appearancePublic && <span className="board-review-mark">{copy.appearanceHidden}</span>}
        </span>
        {record.linkedIn && <RecordLink link={record.linkedIn} copy={copy} />}
        {record.reports.length > 0 && (
          <ul className="board-review-reports">
            {record.reports.map((report) => (
              <ReportLine
                key={report.target}
                report={report}
                language={language}
                copy={copy}
                busy={busy}
                onResolve={(resolution) =>
                  onAction(record, { kind: 'report-resolution', target: report.target, resolution })
                }
              />
            ))}
          </ul>
        )}
        <RecordActions record={record} copy={copy} busy={busy} onAction={(action) => onAction(record, action)} />
      </div>
    </div>
  )
}

/** What stands beside a run: its visitor's record, in full at their newest run and as one line at the others. */
export function RunRecord({
  record,
  newest,
  language,
  copy,
  busy,
  onAction,
}: {
  record: PlayedRecord | null
  newest: boolean
  language: AppLanguage
  copy: BoardReviewCopy
  busy: boolean
  onAction: RecordActionHandler
}) {
  if (!record) return <p className="editor-note">{copy.noRecord}</p>
  if (newest) return <RecordCard record={record} language={language} copy={copy} busy={busy} onAction={onAction} />
  return (
    <p className="editor-note">
      <bdi>{record.name ?? copy.noName}</bdi> · {placeText(record, copy)} · {copy.recordAbove}
    </p>
  )
}

/**
 * The admin's list of who played the derby in a week: the runs, newest first, each beside its visitor's record, and
 * before them the records someone reported. Nothing waits here for approval; the admin takes off afterwards what
 * should not be there. Every action names the version it read, so a record that changed since is refused, and the list
 * says so and reloads.
 */
export function BoardReview({ language, onClose }: { language: AppLanguage; onClose: () => void }) {
  const copy = boardReviewCopy[language]
  const shellCopy = languageCopy[language].boardReview
  const currentSeason = rankingWeek(new Date())
  const [season, setSeason] = useState<string | null>(null)
  // The week the date field names, which may be none while it is half typed.
  const [pickedWeek, setPickedWeek] = useState<string | null>(currentSeason)
  const load = useCallback(() => fetchPlays(season, null), [season])
  const { status, latest, retry, update } = useRetryableLoad(load)
  const [busyIds, setBusyIds] = useState<ReadonlySet<string>>(new Set())
  const [loadingMore, setLoadingMore] = useState(false)
  const [failure, setFailure] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const rows = latest ? playRows(latest) : []

  const act = async (record: PlayedRecord, action: RecordAction) => {
    setBusyIds((current) => new Set([...current, record.id]))
    setFailure(null)
    setNotice(null)
    try {
      const changed = await sendRecordAction(record, action)
      update((shown) => withRecord(shown, changed))
      setNotice(copy.done)
    } catch (error) {
      reportFailure(error)
    } finally {
      setBusyIds((current) => new Set([...current].filter((id) => id !== record.id)))
    }
  }
  const reportFailure = (error: unknown) => {
    setFailure(isStaleBoardReview(error) ? copy.changed : copy.failed)
    if (isStaleBoardReview(error)) retry()
  }
  const recordAction: RecordActionHandler = (record, action) => {
    const question = actionQuestion(record, action, copy)
    if (question && !window.confirm(question)) return
    void act(record, action)
  }
  const loadMore = async (cursor: string) => {
    setLoadingMore(true)
    setFailure(null)
    await fetchPlays(season, cursor).then(
      (next) => update((shown) => withNextPage(shown, next)),
      () => setFailure(copy.failed),
    )
    setLoadingMore(false)
  }
  const reload = () => {
    setFailure(null)
    setNotice(null)
    retry()
  }
  const changeSeason = (value: string) => {
    const picked = pickedSeason(value, currentSeason)
    setPickedWeek(picked)
    if (!picked) return
    setSeason(picked)
    reload()
  }

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
        <div className="board-review-week">
          <label>
            {copy.season}
            <input type="date" defaultValue={currentSeason} onChange={(event) => changeSeason(event.target.value)} />
          </label>
          <button className="text-button" type="button" disabled={status === 'loading'} onClick={reload}>
            {copy.reload}
          </button>
          {latest && <strong>{weekName(latest.season, currentSeason, language)}</strong>}
        </div>
        {!pickedWeek && <p role="status">{copy.pickSeason}</p>}
        {failure && (
          <p className="editor-field-error" role="alert">
            {failure}
          </p>
        )}
        <p className="editor-note" role="status">
          {notice}
        </p>
        {status === 'loading' && <p role="status">{copy.loading}</p>}
        {status === 'error' && (
          <p role="alert">
            {copy.loadError}{' '}
            <button className="text-button" type="button" onClick={retry}>
              {copy.retry}
            </button>
          </p>
        )}
        {latest && latest.unreadable > 0 && <p role="alert">{copy.unreadable(latest.unreadable)}</p>}

        {latest && latest.reported.length > 0 && (
          <section className="board-review-group" aria-labelledby="board-review-reported-title">
            <h3 id="board-review-reported-title">
              {copy.reportedTitle} <span className="board-review-count">{latest.reported.length}</span>
            </h3>
            <ul className="board-review-list">
              {latest.reported.map((record) => (
                <li className="board-review-play" key={record.id}>
                  <RecordCard
                    record={record}
                    language={language}
                    copy={copy}
                    busy={busyIds.has(record.id)}
                    onAction={recordAction}
                  />
                </li>
              ))}
            </ul>
          </section>
        )}

        {latest && (
          <section className="board-review-group" aria-labelledby="board-review-runs-title">
            <h3 id="board-review-runs-title">
              {copy.runsTitle} <span className="board-review-count">{rows.length}</span>
            </h3>
            {rows.length === 0 && <p>{copy.empty}</p>}
            <ul className="board-review-list">
              {rows.map(({ run, record, newest }) => (
                <li className="board-review-play" key={run.id}>
                  <RunSummary run={run} language={language} copy={copy} />
                  <RunRecord
                    record={record}
                    newest={newest}
                    language={language}
                    copy={copy}
                    busy={record !== null && busyIds.has(record.id)}
                    onAction={recordAction}
                  />
                </li>
              ))}
            </ul>
            {latest.nextCursor && (
              <button
                className="primary-button editor-primary"
                type="button"
                disabled={loadingMore || status === 'loading'}
                onClick={() => loadMore(latest.nextCursor ?? '')}
              >
                {copy.loadMore}
              </button>
            )}
          </section>
        )}
      </section>
    </div>
  )
}
