import { useCallback, useEffect, useState } from 'react'
import { getSessionUser } from '../data/adminSession'
import type { TownSnapshot } from '../data/models'
import { fetchTownLayout } from '../data/townApi'
import { ballparkOpens } from './baseballRoute'

export type BallparkGate =
  | { status: 'loading' }
  | { status: 'failed'; error: string }
  | { status: 'closed' }
  | { status: 'open'; town: TownSnapshot }

/** The town, if this page may play it (`ballparkOpens`). */
export async function readBallparkGate(townId: string, preview: boolean): Promise<BallparkGate> {
  const town = await fetchTownLayout(townId)
  const open = await ballparkOpens(town.venues.ballpark, preview, getSessionUser)
  return open ? { status: 'open', town } : { status: 'closed' }
}

/** Reads the town before anything of the derby loads; after a failure, `retry` reads it again. */
export function useBallparkGate(townId: string, preview: boolean) {
  const [attempt, setAttempt] = useState(0)
  const [gate, setGate] = useState<BallparkGate>({ status: 'loading' })

  useEffect(() => {
    let active = true
    void readBallparkGate(townId, preview).then(
      (next) => active && setGate(next),
      (reason: unknown) =>
        active &&
        setGate({ status: 'failed', error: reason instanceof Error ? reason.message : 'Could not load the town' }),
    )
    return () => {
      active = false
    }
  }, [attempt, preview, townId])

  const retry = useCallback(() => {
    setGate({ status: 'loading' })
    setAttempt((current) => current + 1)
  }, [])

  return { gate, retry }
}
