import { describe, expect, it } from 'vitest'
import { daysUntilSeasonEnds } from './boardSeason'

describe('board season', () => {
  it('counts down to a new season in KST days, so the D-day turns at midnight in Korea on any device', () => {
    // November's board ends as December starts in Korea: 2026-12-01 00:00 KST.
    const novemberEnds = Date.parse('2026-11-30T15:00:00.000Z')
    const at = (time: string) => daysUntilSeasonEnds(novemberEnds, Date.parse(time))
    expect(at('2026-11-30T14:59:59.999Z')).toBe(1)
    expect(at('2026-11-29T15:00:00.000Z')).toBe(1)
    expect(at('2026-11-29T14:59:59.999Z')).toBe(2)
    expect(at('2026-10-31T15:00:00.000Z')).toBe(30)
  })
})
