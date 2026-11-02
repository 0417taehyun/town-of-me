import { describe, expect, it } from 'vitest'
import { LeaderboardRequestError, type OwnBoardEntry, type RankedRunBody } from '../../data/leaderboardApi'
import { retryPauseMs, standingLine, unrankedBeforeIssue, unsavedRun } from './rankedRun'

const timed = [100, 120, 110].map((errorMs) => ({ errorMs, speed: 8 }))
const entry: OwnBoardEntry = {
  listed: true,
  name: 'Pip',
  nameStatus: 'approved',
  takedown: false,
  linkedIn: null,
  homeRuns: 3,
  totalDistanceDm: 3434,
  rank: 2,
}
const run = { id: 'run-7', expiresAt: 600_000, rules: { pitchCount: 5, difficulty: 'normal' as const }, seed: 7 }
const body = {} as RankedRunBody

describe('ranked runs', () => {
  it('never asks the board for an admin’s preview, nor for a run practice could not time', () => {
    expect(unrankedBeforeIssue('current', timed)).toBe('preview')
    expect(unrankedBeforeIssue('next', timed)).toBe('preview')
    expect(unrankedBeforeIssue(null, timed.slice(0, 2))).toBe('untimed')
    expect(unrankedBeforeIssue(null, timed)).toBe(null)
  })

  it('raises a statue only for a new best on the board, and says a record off it is not there yet', () => {
    const best = { kind: 'ranked' as const, rank: 2, personalBest: true }
    expect(standingLine(best, entry)).toEqual({ kind: 'statue', rank: 2 })
    expect(standingLine(best, { ...entry, rank: 5 })).toEqual({ kind: 'newBest', rank: 5 })
    expect(standingLine({ ...best, personalBest: false }, entry)).toEqual({
      kind: 'bestStands',
      rank: 2,
      homeRuns: 3,
      totalDistanceDm: 3434,
    })
    const unlisted = { ...entry, listed: false }
    expect(standingLine({ kind: 'unlisted', wouldBeRank: 2, personalBest: true }, unlisted)).toEqual({
      kind: 'offBoard',
      wouldBeRank: 2,
    })
    const anotherPlayer = { kind: 'consentNeeded' as const, wouldBeRank: 2, personalBest: true }
    expect(standingLine(anotherPlayer, unlisted).kind).toBe('consentNeeded')
    // Once the visitor posts it, the record they just set stands as a statue.
    expect(standingLine(anotherPlayer, entry)).toEqual({ kind: 'statue', rank: 2 })
  })

  it('tells a result the board refused apart from one worth sending again, and stops at the run’s time', () => {
    const conflict = new LeaderboardRequestError(409)
    expect(unsavedRun(run, body, conflict, 1000)).toMatchObject({ kind: 'unsaved', reason: 'replaced' })
    expect(unsavedRun(run, body, conflict, 600_000)).toMatchObject({ kind: 'unsaved', reason: 'expired' })
    expect(unsavedRun(run, body, new TypeError('offline'), 1000)).toMatchObject({ reason: 'failed' })
    // A ballpark hidden while the run played ranks nothing, quietly.
    expect(unsavedRun(run, body, new LeaderboardRequestError(503), 1000)).toEqual({
      kind: 'unranked',
      reason: 'offline',
    })
    expect(retryPauseMs(new TypeError('offline'), 0, run.expiresAt, 1000)).toBe(1000)
    expect(retryPauseMs(new LeaderboardRequestError(502), 2, run.expiresAt, 1000)).toBe(4000)
    expect(retryPauseMs(new LeaderboardRequestError(400), 0, run.expiresAt, 1000)).toBe(null)
    expect(retryPauseMs(new LeaderboardRequestError(503), 0, run.expiresAt, 1000)).toBe(null)
    expect(retryPauseMs(new TypeError('offline'), 3, run.expiresAt, 595_000)).toBe(null)
  })
})
