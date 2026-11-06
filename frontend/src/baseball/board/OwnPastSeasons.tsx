import { useState } from 'react'
import { recordText } from '../../data/boardRecord'
import { anonymizeOwnRecord, fetchOwnStatues, type OwnStatueBoard, turnOffLinkedIn } from '../../data/leaderboardApi'
import { type AppLanguage, languageCopy, monthName } from '../../i18n/language'
import { ConfirmedAction } from '../ui/ListingView'
import { useRead } from './useBoard'

type PastSeasonsProps = {
  currentSeason: string
  language: AppLanguage
  /** Goes up when a change outside this list may have changed the statues in it, which reads them again. */
  revision: number
  /** A statue changed, and the board on the page may show it. */
  onChanged: () => void
}

/**
 * The past seasons where this browser's record stands as a statue, each of which it can take down or take its link off.
 * It costs a read a season, so it reads only when the visitor opens it.
 */
export function OwnPastSeasons(props: PastSeasonsProps) {
  const [open, setOpen] = useState(false)
  return (
    <details className="board-own-past" onToggle={(event) => setOpen(event.currentTarget.open)}>
      <summary>{languageCopy[props.language].baseball.leaderboard.ownPastTitle}</summary>
      {open && <OwnPastSeasonList key={props.revision} {...props} />}
    </details>
  )
}

export function OwnPastSeasonList({ currentSeason, language, onChanged }: PastSeasonsProps) {
  const copy = languageCopy[language].baseball
  const { load, reload } = useRead(fetchOwnStatues)
  const changed = () => {
    reload()
    onChanged()
  }
  if (load.status === 'loading') return <span className="loader" aria-busy="true" />
  if (load.status === 'failed')
    return (
      <div className="board-own-past-empty" role="alert">
        <p>{copy.leaderboard.loadFailed}</p>
        <button className="text-button" type="button" onClick={reload}>
          {copy.board.retry}
        </button>
      </div>
    )
  if (load.value.length === 0) return <p className="board-own-past-empty">{copy.leaderboard.ownPastEmpty}</p>
  return (
    <ul className="board-own-past-list">
      {load.value.map((board) => (
        <OwnPastSeasonRow
          key={board.season.id}
          board={board}
          currentSeason={currentSeason}
          language={language}
          onChanged={changed}
        />
      ))}
    </ul>
  )
}

/**
 * A past statue of this browser's: where it stood, as what, and what can still change. A record already anonymous has
 * nothing left to take down, and one taken down loses its link with its name, so only what remains is offered.
 */
export function OwnPastSeasonRow({
  board,
  currentSeason,
  language,
  onChanged,
}: {
  board: OwnStatueBoard
  currentSeason: string
  language: AppLanguage
  onChanged: () => void
}) {
  const copy = languageCopy[language].baseball
  const boardCopy = copy.leaderboard
  const { season, own } = board
  const [busy, setBusy] = useState(false)
  const [failed, setFailed] = useState(false)
  const month = monthName(season.id, currentSeason, language)
  const turnLinkOff = async () => {
    setBusy(true)
    setFailed(false)
    await turnOffLinkedIn(season.id).then(onChanged, () => setFailed(true))
    setBusy(false)
  }
  return (
    <li className="board-own-past-row">
      <div>
        <p>
          <b>{boardCopy.plaqueFinal(month, own.rank)}</b> · {own.name ?? boardCopy.nameAnonymous}
        </p>
        <p className="board-own-past-record">{recordText(own.homeRuns, own.totalDistanceDm, language)}</p>
        {own.linkedIn && <p className="board-own-past-record">{own.linkedIn.profileHint}</p>}
      </div>
      <div className="board-own-past-actions">
        {own.name !== null && (
          <ConfirmedAction
            label={boardCopy.anonymize}
            confirmText={boardCopy.anonymizeConfirm}
            confirmLabel={boardCopy.anonymizeConfirmAction}
            keepLabel={boardCopy.anonymizeKeep}
            failedText={copy.board.problems.saveFailed}
            onConfirm={async () => {
              await anonymizeOwnRecord(season.id)
              onChanged()
            }}
          />
        )}
        {own.linkedIn && (
          <button className="derby-secondary" type="button" disabled={busy} onClick={turnLinkOff}>
            {boardCopy.linkedInOff}
          </button>
        )}
      </div>
      {failed && <p role="alert">{copy.board.problems.saveFailed}</p>}
    </li>
  )
}
