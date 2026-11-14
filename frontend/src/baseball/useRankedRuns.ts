import { useCallback, useEffect, useRef, useState } from 'react'
import {
  deleteOwnRecords,
  type IssuedRun,
  issueRankedRun,
  type ListingChoice,
  type OwnBoardEntry,
  rankedRunBody,
  type RankedRunBody,
  updateOwnRecord,
} from '../data/leaderboardApi'
import type { PlayerProfile } from '../data/playerProfile'
import type { BaseballPreview } from './baseballRoute'
import {
  type BoardRun,
  ISSUE_TIMEOUT_MS,
  pause,
  postedBoardName,
  RESULT_GRACE_MS,
  sendRankedResult,
  unrankedBeforeIssue,
  unsavedRun,
} from './flow/rankedRun'
import type { PracticeSample } from './game/calibration'
import type { DerbyInputLog, DerbyResult } from './game/derbyScore'

/**
 * The page's runs and the weekly board (flow/rankedRun.ts). `issue` asks for a ranked run as one starts and resolves
 * to the run to play, or to `null` to play it unranked: always for a `preview`, which never asks, and whenever the
 * board does not answer in time. `finish` sends the ranked run's result, again while the network fails, and `retry`
 * sends it again at once. `entry` is the visitor's record on this week's board, which `saveListing` and
 * `deleteRecords` change. The runs' results go with the board name of the visitor's listed record, read as the page
 * loads (postedBoardName) and changed by `saveListing`, so they still look like the same player to the board. `abandon`
 * forgets a run the camera stopped, so no later finish is taken for it.
 */
export function useRankedRuns(preview: BaseballPreview | null, batter: PlayerProfile) {
  const [boardRun, setBoardRun] = useState<BoardRun | null>(null)
  const [entry, setEntry] = useState<OwnBoardEntry | null>(null)
  const [name, setName] = useState<string | null>(batter.name)
  const playing = useRef<{ run: IssuedRun; startedAt: number } | null>(null)
  const sending = useRef<{ done: Promise<void>; stop: AbortController } | null>(null)

  useEffect(() => () => sending.current?.stop.abort(), [])
  useEffect(() => {
    if (preview !== null) return
    let active = true
    // Without an answer the character's name goes, as for a visitor not on the board.
    void postedBoardName(batter.name).then(
      (posted) => active && setName(posted),
      () => undefined,
    )
    return () => {
      active = false
    }
  }, [preview, batter.name])

  const send = useCallback((run: IssuedRun, body: RankedRunBody) => {
    sending.current?.stop.abort()
    const stop = new AbortController()
    setBoardRun({ kind: 'saving' })
    const retrying = () => setBoardRun({ kind: 'unsaved', run, body, reason: 'failed' })
    // Once stopped by a newer run or try, an answer still updates the record but no longer speaks for the latest run.
    const done = sendRankedResult(run, body, stop.signal, retrying).then(
      (outcome) => {
        setEntry(outcome.entry)
        if (!stop.signal.aborted) setBoardRun({ kind: 'saved', standing: outcome.standing })
      },
      (error: unknown) => {
        if (!stop.signal.aborted) setBoardRun(unsavedRun(run, body, error, Date.now()))
      },
    )
    sending.current = { done, stop }
  }, [])

  const issue = useCallback(
    async (practice: PracticeSample[]) => {
      playing.current = null
      const unranked = unrankedBeforeIssue(preview, practice)
      if (unranked) {
        setBoardRun({ kind: 'unranked', reason: unranked })
        return null
      }
      // A new run abandons the last one, so a result still on its way gets a moment to arrive first.
      sending.current?.stop.abort()
      await Promise.race([sending.current?.done, pause(RESULT_GRACE_MS)])
      const run = await issueRankedRun(AbortSignal.timeout(ISSUE_TIMEOUT_MS)).catch(() => null)
      playing.current = run && { run, startedAt: performance.now() }
      setBoardRun(run ? { kind: 'playing' } : { kind: 'unranked', reason: 'offline' })
      return run
    },
    [preview],
  )

  const finish = useCallback(
    (result: DerbyResult, log: DerbyInputLog) => {
      const current = playing.current
      playing.current = null
      if (current) send(current.run, rankedRunBody(log, result, performance.now() - current.startedAt, batter, name))
    },
    [batter, name, send],
  )

  const retry = useCallback(() => {
    if (boardRun?.kind === 'unsaved' && boardRun.reason === 'failed') send(boardRun.run, boardRun.body)
  }, [boardRun, send])

  const abandon = useCallback(() => {
    playing.current = null
  }, [])

  const saveListing = useCallback(async (choice: ListingChoice) => {
    const updated = await updateOwnRecord(choice)
    setEntry(updated)
    if (choice.listed) setName(choice.name)
  }, [])

  const deleteRecords = useCallback(async () => {
    await deleteOwnRecords()
    setEntry(null)
    setBoardRun({ kind: 'deleted' })
  }, [])

  return { boardRun, entry, name, issue, finish, retry, abandon, saveListing, deleteRecords }
}
