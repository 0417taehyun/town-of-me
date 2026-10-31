import { afterEach, describe, expect, it, vi } from 'vitest'
import { effectiveBallparkRules, rankingMonth } from './ballparkRules'
import { DEFAULT_TOWN_VENUES, type BallparkSettings } from './models'

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('ballpark ranking months', () => {
  it('turns the month at midnight in Korea, whatever the device time zone', () => {
    const instants = ['2026-10-31T14:59:59Z', '2026-10-31T15:00:00Z', '2026-11-30T15:00:00Z', '2026-12-31T15:00:00Z']
    // Seoul catches an offset applied twice, Los Angeles one never applied, when the month is read from local time.
    const timeZones = ['UTC', 'Asia/Seoul', 'America/Los_Angeles']
    const monthsOnDeviceIn = (timeZone: string) => {
      vi.stubEnv('TZ', timeZone)
      return instants.map((instant) => rankingMonth(new Date(instant)))
    }
    expect(timeZones.map(monthsOnDeviceIn)).toEqual(timeZones.map(() => ['2026-10', '2026-11', '2026-12', '2027-01']))
  })

  it('plays the rules in effect until the scheduled month, then the scheduled rules, across a year boundary', () => {
    const ballpark: BallparkSettings = {
      ...DEFAULT_TOWN_VENUES.ballpark,
      rules: { pitchCount: 5, difficulty: 'normal' },
      scheduledRules: { fromMonth: '2026-12', rules: { pitchCount: 8, difficulty: 'hard' } },
    }
    const months = ['2026-11', '2026-12', '2027-01']
    expect(months.map((month) => effectiveBallparkRules(ballpark, month))).toEqual([
      ballpark.rules,
      ballpark.scheduledRules!.rules,
      ballpark.scheduledRules!.rules,
    ])
    expect(effectiveBallparkRules({ ...ballpark, scheduledRules: undefined }, '2027-01')).toEqual(ballpark.rules)
  })
})
