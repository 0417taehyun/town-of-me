import { describe, expect, it, vi } from 'vitest'
import {
  acceptHeldRun,
  dismissRunsWithoutHistory,
  fetchBoardReview,
  fetchReviewQueue,
  recordActionRequest,
  type RecordAction,
  type ReviewedEntry,
  type ReviewedRun,
} from './boardReviewApi'

const entryId = '7c1f3a90-1111-4222-8333-444455556666'
const wireEntry = {
  id: entryId,
  season: '2026-10',
  rank: 2,
  updatedAt: '2026-10-05T01:02:03.004Z',
  bestRunId: '11111111-1111-4111-8111-111111111111',
  listed: true,
  name: 'Sprout',
  nameStatus: 'pending',
  reviewStatus: 'pending',
  profile: { hair: 'bob', colors: {} },
  appearancePublic: true,
  takedown: false,
  homeRuns: 3,
  totalDistanceDm: 3120,
  achievedAt: '2026-10-05T01:02:03.004Z',
  result: { pitches: [{ pitchType: 'curve', outcome: 'miss', distanceDm: null }] },
  linkedIn: null,
}
const wireItem = {
  kind: 'statue',
  season: '2026-10',
  newVisitor: false,
  visitor: { runs: 4, abandoned: 1, flagged: 0 },
  entry: wireEntry,
  runs: [],
  reports: [],
  warnings: [],
  neighbours: [],
}

describe('board review API boundary', () => {
  it('keeps the readable queue items in the server’s order and counts the ones it dropped', async () => {
    const items = [
      { ...wireItem, kind: 'name' },
      { ...wireItem, kind: 'someday' },
      { ...wireItem, entry: { ...wireEntry, updatedAt: 'not a time' } },
      { ...wireItem, entry: null },
      { ...wireItem, kind: 'statue' },
    ]
    const request = vi.fn(async () => Response.json({ items }))
    const { items: read, unreadable } = await fetchReviewQueue(null, request as typeof fetch)
    expect(read.map(({ kind }) => kind)).toEqual(['name', 'statue'])
    expect(unreadable).toBe(3)
    expect(read[0].entry?.pitches[0]).toMatchObject({ pitchType: 'curve', errorMs: null, power: null })
  })

  it('leaves this season to the server until one is picked, and then reads its queue too', async () => {
    const request = vi.fn(async (path: string) =>
      Response.json(path.includes('/entries') ? { entries: [] } : { items: [] }),
    )
    await fetchBoardReview(null, request as unknown as typeof fetch)
    expect(request.mock.calls.map(([path]) => path)).toEqual([
      '/v1/admin/games/home-run-derby/review',
      '/v1/admin/games/home-run-derby/entries',
    ])
    request.mockClear()
    await fetchBoardReview('2026-09', request as unknown as typeof fetch)
    expect(request.mock.calls.map(([path]) => path)).toEqual([
      '/v1/admin/games/home-run-derby/review',
      '/v1/admin/games/home-run-derby/entries?season=2026-09',
      '/v1/admin/games/home-run-derby/review?season=2026-09',
    ])
  })

  it('names the version it read in every action, and undoes a disqualification with DELETE', () => {
    const entry = { id: entryId, updatedAt: wireEntry.updatedAt }
    const actions: RecordAction[] = [
      { kind: 'approval', name: 'reject' },
      { kind: 'restoration' },
      { kind: 'report-resolution', target: 'link', resolution: 'removed' },
      { kind: 'takedown', blockLinkedIn: true },
    ]
    const sent = actions.map((action) => {
      const { path, init } = recordActionRequest(entry, action)
      return { path, method: init.method, body: JSON.parse(init.body) as unknown }
    })
    const version = { updatedAt: wireEntry.updatedAt }
    expect(sent).toEqual([
      { path: `/entries/${entryId}/approval`, method: 'POST', body: { ...version, name: 'reject' } },
      { path: `/entries/${entryId}/disqualification`, method: 'DELETE', body: version },
      {
        path: `/entries/${entryId}/report-resolution`,
        method: 'POST',
        body: { ...version, target: 'link', resolution: 'removed' },
      },
      { path: `/entries/${entryId}/takedown`, method: 'POST', body: { ...version, blockLinkedIn: true } },
    ])
  })

  it('accepts a held run from having no record, and sends the bulk dismissal only its season and scope', async () => {
    const request = vi.fn(async (path: string) =>
      Response.json(path.endsWith('/acceptance') ? { entry: wireEntry } : { season: '2026-10', rejected: 2 }),
    )
    const run = { id: 'held-run' } as ReviewedRun
    await acceptHeldRun(run, null, request as unknown as typeof fetch)
    await acceptHeldRun(run, wireEntry as unknown as ReviewedEntry, request as unknown as typeof fetch)
    expect(await dismissRunsWithoutHistory('2026-10', request as unknown as typeof fetch)).toBe(2)
    const calls = request.mock.calls as unknown as Array<[string, RequestInit]>
    expect(calls.map(([path, init]) => [path, JSON.parse(init.body as string)])).toEqual([
      ['/v1/admin/games/home-run-derby/runs/held-run/acceptance', { updatedAt: null }],
      ['/v1/admin/games/home-run-derby/runs/held-run/acceptance', { updatedAt: wireEntry.updatedAt }],
      ['/v1/admin/games/home-run-derby/runs/rejection', { season: '2026-10', scope: 'no-history' }],
    ])
  })
})
