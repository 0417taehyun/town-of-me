import { describe, expect, it } from 'vitest'
import type { PlayedLink, PlayedRecord, PlayedRun, PlaysPage } from '../data/boardReviewApi'
import { LeaderboardRequestError } from '../data/leaderboardApi'
import { boardReviewCopy } from './boardReviewCopy'
import {
  actionQuestion,
  isStaleBoardReview,
  linkView,
  pickedSeason,
  placeText,
  playRows,
  recordButtons,
  recordChoices,
  withLinkBlock,
  withNextPage,
  withRecord,
} from './boardReviewing'

const copy = boardReviewCopy.en

function record(id: string, visitor: string, changes: Partial<PlayedRecord> = {}): PlayedRecord {
  return {
    id,
    season: '2026-11-09',
    visitor,
    rank: 1,
    updatedAt: '2026-11-10T00:00:00.000Z',
    bestRunId: null,
    listed: true,
    name: 'Sprout',
    nameStatus: 'shown',
    disqualified: false,
    profile: null,
    appearancePublic: true,
    takedown: false,
    homeRuns: 3,
    totalDistanceDm: 3120,
    achievedAt: '2026-11-10T00:00:00.000Z',
    linkedIn: null,
    reports: [],
    ...changes,
  }
}

function run(id: string, visitor: string): PlayedRun {
  return {
    id,
    season: '2026-11-09',
    visitor,
    status: 'scored',
    flags: [],
    best: false,
    issuedAt: '2026-11-10T00:00:00.000Z',
    submittedAt: null,
    homeRuns: 1,
    totalDistanceDm: 1100,
    result: null,
  }
}

function page(changes: Partial<PlaysPage>): PlaysPage {
  return { season: '2026-11-09', runs: [], records: [], reported: [], nextCursor: null, unreadable: 0, ...changes }
}

function link(profileUrl: string, profileId: string, encoded = false): PlayedLink {
  return { profileUrl, profileId, encoded, status: 'verified', verifiedName: null }
}

describe('the list of plays', () => {
  it('puts each run beside its visitor’s record, in full only at their newest run', () => {
    const rows = playRows({
      runs: [run('r3', 'ann'), run('r2', 'bob'), run('r1', 'ann'), run('r0', 'cat')],
      records: [record('a', 'ann'), record('b', 'bob')],
    })
    expect(rows.map(({ record: joined, newest }) => [joined?.id ?? null, newest])).toEqual([
      ['a', true],
      ['b', true],
      ['a', false],
      [null, true],
    ])
  })

  it('adds a page after the last without repeating a visitor’s record, and drops one from another week', () => {
    const reported = [record('z', 'zed', { reports: [{ target: 'name', count: 1, mine: false, lastReportedAt: '' }] })]
    const shown = page({ runs: [run('r2', 'ann')], records: [record('a', 'ann')], reported, nextCursor: 'next' })
    const next = page({ runs: [run('r1', 'ann'), run('r0', 'bob')], records: [record('a', 'ann'), record('b', 'bob')] })
    const both = withNextPage(shown, next)
    expect(both.runs.map(({ id }) => id)).toEqual(['r2', 'r1', 'r0'])
    expect(both.records.map(({ id }) => id)).toEqual(['a', 'b'])
    expect([both.reported.length, both.nextCursor]).toEqual([1, null])
    expect(withNextPage(shown, { ...next, season: '2026-11-02' })).toBe(shown)
  })

  it('leaves an action’s answer wherever the record shows, and a record with no report left out of the reports', () => {
    const open = [{ target: 'name' as const, count: 1, mine: false, lastReportedAt: '2026-11-10T00:00:00.000Z' }]
    const shown = page({
      records: [record('a', 'ann', { reports: open })],
      reported: [record('a', 'ann', { reports: open })],
    })
    const kept = withRecord(shown, record('a', 'ann', { reports: open, updatedAt: '2026-11-11T00:00:00.000Z' }))
    expect([kept.records[0].updatedAt, kept.reported[0].updatedAt]).toEqual(Array(2).fill('2026-11-11T00:00:00.000Z'))
    const resolved = withRecord(shown, record('a', 'ann', { nameStatus: 'rejected' }))
    expect([resolved.records[0].nameStatus, resolved.reported.length]).toEqual(['rejected', 0])
  })
})

describe('a record’s actions', () => {
  it('offers only what the server takes: a removed record goes back, a taken-down one keeps its character hidden', () => {
    expect(recordChoices(record('a', 'ann'))).toMatchObject({ remove: true, restore: false, hideName: true })
    const removed = record('a', 'ann', { disqualified: true, rank: null })
    expect(recordChoices(removed)).toMatchObject({ remove: false, restore: true })
    expect(placeText(removed, copy)).toBe(copy.removed)
    const takenDown = record('a', 'ann', { takedown: true, name: null, nameStatus: null, appearancePublic: false })
    expect(recordChoices(takenDown)).toMatchObject({ showAppearance: false, takedown: false, hideName: false })
    const refused = record('a', 'ann', { nameStatus: 'rejected' })
    expect(recordButtons(refused, copy).map(({ action }) => action)).toContainEqual({ kind: 'name', public: true })
  })

  it('asks before removing a record, deleting a link however it goes, or showing a refused name, and nothing else', () => {
    const linked = record('7c1f3a90-1111', 'ann', { linkedIn: link('https://www.linkedin.com/in/sprout', 'sprout') })
    expect(actionQuestion(linked, { kind: 'disqualification' }, copy)).toContain('record 7c1f3a90')
    expect(actionQuestion(linked, { kind: 'linkedin-removal' }, copy)).not.toBe(null)
    const removedLink = { kind: 'report-resolution', target: 'link', resolution: 'removed' } as const
    expect(actionQuestion(linked, removedLink, copy)).not.toBe(null)
    expect(actionQuestion(linked, { ...removedLink, resolution: 'kept' }, copy)).toBe(null)
    expect(actionQuestion(linked, { kind: 'name', public: true }, copy)).not.toBe(null)
    expect(actionQuestion(linked, { kind: 'name', public: false }, copy)).toBe(null)
    expect(actionQuestion(linked, { kind: 'restoration' }, copy)).toBe(null)
  })

  it('blocks a profile only with a link’s removal or a takedown, and only when asked', () => {
    expect(withLinkBlock({ kind: 'takedown' }, true)).toEqual({ kind: 'takedown', blockLinkedIn: true })
    expect(withLinkBlock({ kind: 'linkedin-removal' }, false)).toEqual({ kind: 'linkedin-removal' })
    expect(withLinkBlock({ kind: 'name', public: false }, true)).toEqual({ kind: 'name', public: false })
  })

  it('reloads when the record changed or its visitor deleted it, and not for any other failure', () => {
    expect(isStaleBoardReview(new LeaderboardRequestError(409))).toBe(true)
    expect(isStaleBoardReview(new LeaderboardRequestError(404))).toBe(true)
    expect(isStaleBoardReview(new LeaderboardRequestError(500))).toBe(false)
    expect(isStaleBoardReview(new TypeError('offline'))).toBe(false)
  })
})

describe('a record’s link', () => {
  it('opens only a plain LinkedIn profile, whatever the server sent', () => {
    expect(linkView(link('https://www.linkedin.com/in/sprout-sample', 'sprout-sample')).href).toBe(
      'https://www.linkedin.com/in/sprout-sample',
    )
    const unsafe = [
      'javascript:alert(1)',
      'https://linkedin.com.example/in/sprout',
      'http://www.linkedin.com/in/sprout',
    ]
    expect(unsafe.map((address) => linkView(link(address, 'sprout')))).toEqual(
      unsafe.map((address) => ({ href: null, text: address, encoded: false })),
    )
  })
})

describe('the season a date names', () => {
  it('is the KST week of the picked day, and none for a half-typed date or a board still to come', () => {
    const picked = ['2026-11-15', '2026-11-16', '2026-11-22', '2026-11-23', '2026-11', '']
    expect(picked.map((value) => pickedSeason(value, '2026-11-16'))).toEqual([
      '2026-11-09',
      '2026-11-16',
      '2026-11-16',
      null,
      null,
      null,
    ])
  })
})
