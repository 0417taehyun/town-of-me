import { describe, expect, it, vi } from 'vitest'
import { LeaderboardRequestError, type OwnBoardEntry, type RankedRunBody } from '../../data/leaderboardApi'
import { postedBoardName, retryPauseMs, standingLine, unrankedBeforeIssue, unsavedRun } from './rankedRun'

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
  awaitingApproval: false,
}
const run = { id: 'run-7', expiresAt: 600_000, rules: { pitchCount: 5, difficulty: 'normal' as const }, seed: 7 }
const body = {} as RankedRunBody
/** A season's board as the server sends it, empty but for the visitor's own record. */
const boardOf = (id: string, own: Partial<OwnBoardEntry> | null) => ({
  season: { id, startsAt: `${id}T00:00:00+09:00`, endsAt: `${id}T23:00:00+09:00`, final: false },
  podium: [],
  ranks: [],
  own: own && { ...entry, ...own, profile: { hair: 'bob' } },
})
const boardsOf = (boards: Record<string, ReturnType<typeof boardOf>>) =>
  vi.fn<typeof fetch>(async (input) => Response.json(boards[new URL(String(input), 'http://town.test').search]))

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
    // Once the visitor posts it, the record they just set stands as a statue, unless it still waits for approval.
    expect(standingLine(anotherPlayer, entry)).toEqual({ kind: 'statue', rank: 2 })
    expect(standingLine(anotherPlayer, { ...entry, awaitingApproval: true })).toEqual({ kind: 'reviewing' })
    expect(standingLine(anotherPlayer, { ...unlisted, awaitingApproval: true }).kind).toBe('consentNeeded')
  })

  it('sends the next runs under the name the record was posted with, even once the page loads again', async () => {
    // Posted as "Pipster" while playing Pip: a result under "Pip" would take the record and its link off the board.
    expect(await postedBoardName('Pip', boardsOf({ '': boardOf('2026-11-09', { name: 'Pipster' }) }))).toBe('Pipster')
    expect(await postedBoardName('Pip', boardsOf({ '': boardOf('2026-11-09', { name: null }) }))).toBe(null)
    // A record off the board kept no name, so the character's goes.
    const unlisted = boardsOf({ '': boardOf('2026-11-09', { listed: false, name: null, nameStatus: null }) })
    expect(await postedBoardName('Pip', unlisted)).toBe('Pip')
    // A week's first run is listed like last week's record when it goes under that record's name.
    const newWeek = boardsOf({
      '': boardOf('2026-11-09', null),
      '?season=2026-11-02': boardOf('2026-11-02', { name: 'Pipster' }),
    })
    expect(await postedBoardName('Pip', newWeek)).toBe('Pipster')
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
