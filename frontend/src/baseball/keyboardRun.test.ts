import { describe, expect, it } from 'vitest'
import { DEFAULT_TOWN_VENUES, type BallparkSettings } from '../data/models'
import { createDerbyRun } from './keyboardRun'

describe('a derby run', () => {
  it('plays the rules of the KST month it starts in, so a run past midnight in Korea gets the new month', () => {
    const ballpark: BallparkSettings = {
      ...DEFAULT_TOWN_VENUES.ballpark,
      rules: { pitchCount: 5, difficulty: 'normal' },
      scheduledRules: { fromMonth: '2026-11', rules: { pitchCount: 8, difficulty: 'hard' } },
    }
    const lastOctoberRun = createDerbyRun(ballpark, new Date('2026-10-31T14:59:00Z'), 7, 'camera')
    const firstNovemberRun = createDerbyRun(ballpark, new Date('2026-10-31T15:01:00Z'), 7, 'camera')
    expect(lastOctoberRun.plan.rules).toEqual(ballpark.rules)
    expect(firstNovemberRun.plan.rules).toEqual(ballpark.scheduledRules!.rules)
    expect(firstNovemberRun.plan.schedule).toHaveLength(8)
    expect(firstNovemberRun.log.input).toBe('camera')
  })
})
