import { describe, expect, it } from 'vitest'
import type { BoardReviewData, ReviewedEntry, ReviewedLink, ReviewItem } from '../data/boardReviewApi'
import { DEFAULT_PLAYER_PROFILE } from '../data/playerProfile'
import {
  boardNeighbours,
  findRecords,
  FOUND_RECORDS_SHOWN,
  foundItem,
  linkView,
  neighbourLines,
  noHistoryRuns,
  recordChoices,
  withEntry,
  withoutRun,
} from './boardReviewing'

function entry(id: string, name: string | null, changes: Partial<ReviewedEntry> = {}): ReviewedEntry {
  return {
    id,
    season: '2026-11',
    rank: 1,
    updatedAt: '2026-11-01T00:00:00.000Z',
    bestRunId: null,
    listed: true,
    name,
    nameStatus: name === null ? null : 'approved',
    reviewStatus: 'approved',
    profile: DEFAULT_PLAYER_PROFILE,
    appearancePublic: true,
    takedown: false,
    homeRuns: 1,
    totalDistanceDm: 1000,
    achievedAt: '2026-11-01T00:00:00.000Z',
    pitches: [],
    linkedIn: null,
    ...changes,
  }
}

function item(changes: Partial<ReviewItem>): ReviewItem {
  return {
    kind: 'run',
    season: '2026-11',
    newVisitor: false,
    visitor: { runs: 5, abandoned: 0, flagged: 1 },
    entry: null,
    runs: [],
    reports: [],
    warnings: [],
    neighbours: [],
    ...changes,
  }
}

const heldRun = (id: string) =>
  ({
    id,
    season: '2026-11',
    flags: [],
    wouldBeRank: 1,
    issuedAt: '2026-11-01T00:00:00.000Z',
    submittedAt: null,
    name: null,
    profile: null,
    result: null,
  }) as ReviewItem['runs'][number]

describe('finding a record', () => {
  const records = [
    entry('a1b2c3d4-0000-4000-8000-000000000001', 'Sprout'),
    entry('e5f60718-0000-4000-8000-000000000002', null, { takedown: true }),
    entry('90aa11bb-0000-4000-8000-000000000003', 'ＰＥＢＢＬＥ stone'),
  ]

  it('finds by a takedown email’s record number, however it was pasted, even with no name left', () => {
    expect(findRecords(records, '  E5F60718 ').shown.map(({ id }) => id)).toEqual([records[1].id])
  })

  it('finds a name anywhere within it, ignoring case and full-width forms, and nothing for an empty search', () => {
    expect(findRecords(records, 'pebble').shown).toEqual([records[2]])
    expect(findRecords(records, 'prou').shown).toEqual([records[0]])
    expect(findRecords(records, 'null').total).toBe(0)
    expect(findRecords(records, '   ').total).toBe(0)
  })

  it('caps what it shows on a big board and still says how many matched', () => {
    const many = Array.from({ length: FOUND_RECORDS_SHOWN + 5 }, (_, index) => entry(`id-${index}`, `Clover ${index}`))
    const found = findRecords(many, 'clover')
    expect(found.total).toBe(FOUND_RECORDS_SHOWN + 5)
    expect(found.shown).toHaveLength(FOUND_RECORDS_SHOWN)
    expect(found.shown[0].id).toBe('id-0')
  })

  it('gives a found record its queue item, so its reports stay in reach, or the record alone', () => {
    const queued = entry('queued', 'Maple')
    const reported = item({
      kind: 'report',
      entry: queued,
      reports: [{ target: 'name', count: 2, mine: false, lastReportedAt: '2026-11-01T00:00:00.000Z' }],
    })
    const quiet = entry('quiet', 'Juniper')
    const data: BoardReviewData = {
      queue: [],
      season: '2026-11',
      records: [queued, quiet],
      seasonQueue: [reported],
      unreadable: 0,
    }
    expect(foundItem(queued, data)).toBe(reported)
    expect(foundItem(queued, { ...data, seasonQueue: [], queue: [reported] })).toBe(reported)
    expect(foundItem(quiet, data)).toMatchObject({ kind: null, visitor: null, entry: quiet, reports: [], runs: [] })
  })
})

describe('the names around a record', () => {
  const off = { listed: false }
  const records = [
    entry('one', 'One'),
    entry('hidden', 'Hidden', off),
    entry('two', 'Two'),
    entry('three', 'Three'),
    entry('gone', 'Gone', { reviewStatus: 'disqualified' }),
    entry('four', 'Four'),
    entry('five', 'Five'),
    entry('six', 'Six'),
    entry('seven', 'Seven'),
    entry('eight', 'Eight'),
  ]

  it('takes three places either side in the public order, skipping records off the board', () => {
    expect(boardNeighbours(records, records[6])).toEqual([
      { rank: 2, name: 'Two' },
      { rank: 3, name: 'Three' },
      { rank: 4, name: 'Four' },
      { rank: 6, name: 'Six' },
      { rank: 7, name: 'Seven' },
      { rank: 8, name: 'Eight' },
    ])
    expect(boardNeighbours(records, records[0]).map(({ rank }) => rank)).toEqual([2, 3, 4])
    expect(boardNeighbours(records, records[1])).toEqual([])
  })

  it('reads with the record’s own name in place', () => {
    const lines = neighbourLines(
      item({
        entry: entry('two', 'Two', { rank: 2 }),
        neighbours: [
          { rank: 1, name: 'One' },
          { rank: 3, name: null },
        ],
      }),
    )
    expect(lines.map(({ rank, self }) => [rank, self])).toEqual([
      [1, false],
      [2, true],
      [3, false],
    ])
  })
})

describe('what a record offers', () => {
  it('offers no approval while disqualified, since the server refuses it, only the undo', () => {
    const choices = recordChoices(entry('gone', 'Gone', { reviewStatus: 'disqualified', nameStatus: 'pending' }))
    expect(choices).toMatchObject({
      approveName: false,
      rejectName: false,
      approveRecord: false,
      disqualify: false,
      restore: true,
    })
  })

  it('never approves a waiting record without deciding its waiting name', () => {
    const waitingName = recordChoices(entry('a', 'Name', { reviewStatus: 'pending', nameStatus: 'pending' }))
    expect(waitingName).toMatchObject({ approveName: true, rejectName: true, approveRecord: false })
    const nameless = recordChoices(entry('b', null, { reviewStatus: 'pending' }))
    expect(nameless).toMatchObject({ approveName: false, rejectName: false, approveRecord: true })
  })

  it('never shows a taken-down record’s character again or takes it down twice', () => {
    const taken = recordChoices(entry('a', null, { takedown: true, appearancePublic: false }))
    expect(taken).toMatchObject({ showAppearance: false, hideAppearance: false, takedown: false })
    expect(recordChoices(entry('b', 'Name', { appearancePublic: false })).showAppearance).toBe(true)
  })
})

describe('how a link reads', () => {
  const link = (profileUrl: string, profileId: string, encoded = false): ReviewedLink => ({
    profileUrl,
    profileId,
    encoded,
    status: 'pending',
    code: 'TOM-7KQ2',
  })

  it('opens only a plain LinkedIn profile, whatever the server sent', () => {
    expect(linkView(link('https://www.linkedin.com/in/sprout-sample', 'sprout-sample')).href).toBe(
      'https://www.linkedin.com/in/sprout-sample',
    )
    for (const unsafe of [
      'javascript:alert(1)',
      'https://linkedin.com.example/in/sprout',
      'http://www.linkedin.com/in/sprout',
      'https://www.linkedin.com/company/sprout',
    ]) {
      expect(linkView(link(unsafe, 'sprout'))).toMatchObject({ href: null, text: unsafe })
    }
  })

  it('shows the decoded id and keeps a percent-encoded address openable', () => {
    const view = linkView(link('https://www.linkedin.com/in/%EC%83%88%EC%8B%B9-sample', '새싹-sample', true))
    expect(view).toEqual({
      text: '새싹-sample',
      encoded: true,
      href: 'https://www.linkedin.com/in/%EC%83%88%EC%8B%B9-sample',
    })
  })
})

describe('the bulk dismissal', () => {
  it('counts per season the held runs of visitors with no history, and no one else', () => {
    const items = [
      item({ season: '2026-11', newVisitor: true, runs: [heldRun('a'), heldRun('b')], entry: entry('rec-a', 'A') }),
      item({ season: '2026-11', newVisitor: false, runs: [heldRun('c')] }),
      item({ season: '2026-11', newVisitor: true, runs: [], entry: entry('rec-b', 'B') }),
      item({ season: '2026-10', newVisitor: true, runs: [heldRun('d')] }),
    ]
    expect(noHistoryRuns(items)).toEqual([
      { season: '2026-11', runs: 2, keys: ['rec-a'] },
      { season: '2026-10', runs: 1, keys: ['d'] },
    ])
  })
})

describe('an answered action', () => {
  const data: BoardReviewData = {
    queue: [
      item({ entry: entry('rec', 'Maple'), runs: [heldRun('kept'), heldRun('settled')] }),
      item({ entry: null, runs: [heldRun('only')] }),
    ],
    season: '2026-11',
    records: [entry('rec', 'Maple')],
    seasonQueue: [],
    unreadable: 0,
  }

  it('leaves the new version everywhere the record shows, so the next action is not refused as stale', () => {
    const changed = entry('rec', 'Maple', { updatedAt: '2026-11-02T00:00:00.000Z' })
    const next = withEntry(data, changed)
    expect(next.queue[0].entry?.updatedAt).toBe(changed.updatedAt)
    expect(next.records[0].updatedAt).toBe(changed.updatedAt)
    expect(next.queue[1].entry).toBeNull()
  })

  it('takes a settled run off, and the item with it when nothing is left to act on', () => {
    expect(withoutRun(data, 'settled').queue[0].runs.map(({ id }) => id)).toEqual(['kept'])
    expect(withoutRun(data, 'only').queue).toHaveLength(1)
  })
})
