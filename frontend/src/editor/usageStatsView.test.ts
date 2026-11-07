import { describe, expect, it } from 'vitest'
import type { UsageStats } from '../data/usageStatsApi'
import {
  axisTop,
  dailyRows,
  dayLabel,
  daysBetween,
  eventTotal,
  isEmptyStats,
  largestDailyCount,
  stepTotal,
} from './usageStatsView'

const stats: UsageStats = {
  range: { from: '2026-02-27', to: '2026-03-02' },
  daily: [
    { day: '2026-02-28', event: 'entered-town', count: 3 },
    { day: '2026-03-02', event: 'entered-town', count: 2 },
    { day: '2026-03-02', event: 'resident-talk', count: 7 },
  ],
  residents: [],
  guestbook: { byStatus: { pending: 1, approved: 1 }, byDay: [{ day: '2026-03-01', count: 2 }] },
  derby: [],
}

describe('usage statistics view', () => {
  it('lists every day of a range across a month boundary, both ends included', () => {
    expect(daysBetween('2026-02-27', '2026-03-02')).toEqual(['2026-02-27', '2026-02-28', '2026-03-01', '2026-03-02'])
    expect(daysBetween('2026-03-02', '2026-03-02')).toEqual(['2026-03-02'])
    expect(daysBetween('2026-03-03', '2026-03-02')).toEqual([])
  })

  it('fills the days without a count, and takes notes written from the guestbook', () => {
    const rows = dailyRows(stats)
    expect(rows.map(({ day }) => day)).toEqual(['2026-02-27', '2026-02-28', '2026-03-01', '2026-03-02'])
    expect(rows.map(({ counts }) => counts['entered-town'])).toEqual([0, 3, 0, 2])
    expect(rows.map(({ counts }) => counts['notes-written'])).toEqual([0, 0, 2, 0])
    expect(stepTotal(rows, 'entered-town')).toBe(5)
    expect(stepTotal(rows, 'notes-written')).toBe(2)
    expect(stepTotal(rows, 'first-talk')).toBe(0)
  })

  it('shares an axis over the steps only, so a busy event outside them cannot flatten the charts', () => {
    expect(largestDailyCount(dailyRows(stats))).toBe(3)
    expect(eventTotal(stats, 'resident-talk')).toBe(7)
    expect(eventTotal(stats, 'map-opened')).toBe(0)
  })

  it('rounds an axis up to a clean number that still holds the largest count', () => {
    const tops = [0, 1, 5, 6, 10, 11, 21, 51, 101, 130].map(axisTop)
    expect(tops).toEqual([1, 1, 5, 10, 10, 20, 50, 100, 200, 200])
  })

  it('is empty only with nothing counted, nothing written, and nothing played', () => {
    const empty = { ...stats, daily: [], guestbook: { byStatus: { pending: 0, approved: 0 }, byDay: [] } }
    expect(isEmptyStats(empty)).toBe(true)
    expect(isEmptyStats(stats)).toBe(false)
    expect(isEmptyStats({ ...empty, derby: [{ month: '2026-03', runs: 1, records: 0 }] })).toBe(false)
    expect(isEmptyStats({ ...empty, guestbook: stats.guestbook })).toBe(false)
  })

  it('names a KST day as itself, whatever the time zone of the device', () => {
    expect(dayLabel('2026-03-01', 'en')).toBe('Mar 1')
  })
})
