import { useCallback, useEffect, useState } from 'react'
import { previousRankingMonth } from '../../data/ballparkRules'
import { type Board, fetchBoard } from '../../data/leaderboardApi'

/** A season's board as the page has it; an empty month also has last month's, for the statues it had. */
export type BoardLoad =
  { status: 'loading' } | { status: 'failed' } | { status: 'ready'; board: Board; lastSeason: Board | null }

/** This month's board with no statues yet brings last month's, whose champions the page shows beneath it. */
export async function readBoard(season: string | null): Promise<BoardLoad> {
  const board = await fetchBoard(season)
  const empty = !board.season.final && board.podium.length === 0
  const lastSeason = empty ? await fetchBoard(previousRankingMonth(board.season.id)).catch(() => null) : null
  return { status: 'ready', board, lastSeason }
}

/** The board of `season` (`null` for this month's), read again by `reload` after a failure or a change. */
export function useBoard(season: string | null) {
  const [attempt, setAttempt] = useState(0)
  const [load, setLoad] = useState<{ key: string; load: BoardLoad } | null>(null)
  const key = `${season ?? 'current'}:${attempt}`

  useEffect(() => {
    let active = true
    void readBoard(season).then(
      (next) => active && setLoad({ key, load: next }),
      () => active && setLoad({ key, load: { status: 'failed' } }),
    )
    return () => {
      active = false
    }
  }, [key, season])

  const reload = useCallback(() => setAttempt((current) => current + 1), [])
  // A reload keeps showing the board it has until the new one arrives, so the page does not jump.
  const kept = load?.load.status === 'ready' && load.key.startsWith(`${season ?? 'current'}:`)
  const shown = load && (load.key === key || kept) ? load.load : null
  return { load: shown ?? ({ status: 'loading' } as const), reload }
}

/** Something else the board's page reads: the hall of fame, or the visitor's past statues. */
export type ReadState<Value> = { status: 'loading' } | { status: 'failed' } | { status: 'ready'; value: Value }

/**
 * Reads when mounted and again by `reload`, which keeps showing what it has until the new answer arrives. `read` must
 * be a stable function.
 */
export function useRead<Value>(read: () => Promise<Value>) {
  const [attempt, setAttempt] = useState(0)
  const [load, setLoad] = useState<ReadState<Value>>({ status: 'loading' })

  useEffect(() => {
    let active = true
    void read().then(
      (value) => active && setLoad({ status: 'ready', value }),
      () => active && setLoad({ status: 'failed' }),
    )
    return () => {
      active = false
    }
  }, [attempt, read])

  const reload = useCallback(() => setAttempt((current) => current + 1), [])
  return { load, reload }
}
