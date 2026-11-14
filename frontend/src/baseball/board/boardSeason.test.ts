import { describe, expect, it } from 'vitest'
import { daysUntilSeasonEnds } from './boardSeason'

describe('board season', () => {
  it('counts down to a new season in KST days, so the D-day turns at midnight in Korea on any device', () => {
    // The week of 2026-11-09 ends as the next Monday starts in Korea: 2026-11-16 00:00 KST.
    const weekEnds = Date.parse('2026-11-15T15:00:00.000Z')
    const at = (time: string) => daysUntilSeasonEnds(weekEnds, Date.parse(time))
    expect(at('2026-11-15T14:59:59.999Z')).toBe(1)
    expect(at('2026-11-14T15:00:00.000Z')).toBe(1)
    expect(at('2026-11-14T14:59:59.999Z')).toBe(2)
    expect(at('2026-11-08T15:00:00.000Z')).toBe(7)
  })
})
