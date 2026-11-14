import { describe, expect, it, vi } from 'vitest'
import { fetchPlays, recordActionRequest, sendRecordAction, type PlayedRecord } from './boardReviewApi'
import { LeaderboardRequestError } from './leaderboardApi'

const entryId = '7c1f3a90-1111-4222-8333-444455556666'
const wireRecord = {
  id: entryId,
  season: '2026-11-02',
  visitor: 'a1b2c3d4e5f6',
  rank: 2,
  updatedAt: '2026-11-05T01:02:03.004Z',
  bestRunId: '11111111-1111-4111-8111-111111111111',
  listed: true,
  name: 'Sprout',
  nameStatus: 'shown',
  disqualified: false,
  profile: { hair: 'bob', colors: {} },
  appearancePublic: true,
  takedown: false,
  homeRuns: 3,
  totalDistanceDm: 3120,
  achievedAt: '2026-11-05T01:02:03.004Z',
  linkedIn: {
    profileUrl: 'https://www.linkedin.com/in/sprout-sample',
    profileId: 'sprout-sample',
    encoded: false,
    status: 'verified',
    verifiedName: 'Someone Else',
  },
  reports: [{ target: 'link', count: 2, mine: true, lastReportedAt: '2026-11-05T02:00:00.000Z' }],
}
const wireRun = {
  id: '11111111-1111-4111-8111-111111111111',
  season: '2026-11-02',
  visitor: 'a1b2c3d4e5f6',
  status: 'scored',
  flags: ['not-from-browser'],
  best: true,
  issuedAt: '2026-11-05T01:00:00.000Z',
  submittedAt: '2026-11-05T01:02:03.004Z',
  homeRuns: 3,
  totalDistanceDm: 3120,
  result: null,
}

describe('derby plays API boundary', () => {
  it('asks for the page after a cursor as it came, keeps the rows that read, and counts the ones it dropped', async () => {
    const page = {
      season: '2026-11-02',
      runs: [wireRun, { ...wireRun, id: 'open', status: 'issued', homeRuns: null, totalDistanceDm: null }],
      records: [wireRecord, { ...wireRecord, updatedAt: 'not a time' }, { ...wireRecord, profile: null }],
      reported: [{ ...wireRecord, nameStatus: 'pending' }],
      nextCursor: null,
    }
    const request = vi.fn<typeof fetch>(async () => Response.json(page))
    const cursor = '2026-11-05T01:00:00.000Z_11111111-1111-4111-8111-111111111111'
    const read = await fetchPlays('2026-11-02', cursor, request)
    expect(request.mock.calls[0][0]).toBe(
      `/v1/admin/games/home-run-derby/plays?season=2026-11-02&cursor=${encodeURIComponent(cursor)}`,
    )
    expect(read.runs.map(({ status, homeRuns }) => [status, homeRuns])).toEqual([
      ['scored', 3],
      ['issued', null],
    ])
    // The account that signed in for the link is what the admin compares the address with.
    expect(read.records[0].linkedIn).toMatchObject({ status: 'verified', verifiedName: 'Someone Else' })
    // A taken-down record has no character at all, not the default one.
    expect(read.records.map(({ profile }) => profile === null)).toEqual([false, true])
    expect([read.reported.length, read.unreadable, read.nextCursor]).toEqual([0, 2, null])

    // Until a week is picked the server decides which one this is.
    await fetchPlays(null, null, request)
    expect(request.mock.calls[1][0]).toBe('/v1/admin/games/home-run-derby/plays')
  })

  it('names the version it read in every action, puts a record back with DELETE, and fails on a stale one', async () => {
    const record = { id: entryId, updatedAt: wireRecord.updatedAt }
    const removal = recordActionRequest(record, { kind: 'disqualification' })
    const restoration = recordActionRequest(record, { kind: 'restoration' })
    expect([removal.path, removal.init.method]).toEqual([`/entries/${entryId}/disqualification`, 'POST'])
    expect([restoration.path, restoration.init.method]).toEqual([`/entries/${entryId}/disqualification`, 'DELETE'])
    expect(JSON.parse(restoration.init.body)).toEqual({ updatedAt: wireRecord.updatedAt })
    const name = recordActionRequest(record, { kind: 'name', public: false })
    expect(name.path).toBe(`/entries/${entryId}/name`)
    expect(JSON.parse(name.init.body)).toEqual({ updatedAt: wireRecord.updatedAt, public: false })
    const blocked = recordActionRequest(record, { kind: 'linkedin-removal', blockLinkedIn: true })
    expect(JSON.parse(blocked.init.body)).toEqual({ updatedAt: wireRecord.updatedAt, blockLinkedIn: true })

    const stale = vi.fn(async () => new Response(null, { status: 409 }))
    const sent = sendRecordAction(record as PlayedRecord, { kind: 'takedown' }, stale as typeof fetch)
    await expect(sent).rejects.toEqual(new LeaderboardRequestError(409))
  })
})
