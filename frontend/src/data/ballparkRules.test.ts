import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  effectiveBallparkRules,
  nextRankingMonth,
  plannedBallparkRules,
  rankingMonth,
  upcomingBallparkRules,
} from './ballparkRules'
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

  it('schedules for the month after, into the next year from December, whatever the device time zone', () => {
    const timeZones = ['UTC', 'Asia/Seoul', 'America/Los_Angeles']
    const nextMonthsOnDeviceIn = (timeZone: string) => {
      vi.stubEnv('TZ', timeZone)
      return ['2026-09', '2026-11', '2026-12'].map(nextRankingMonth)
    }
    expect(timeZones.map(nextMonthsOnDeviceIn)).toEqual(timeZones.map(() => ['2026-10', '2026-12', '2027-01']))
  })

  it('plays the rules in effect and announces the schedule until its month, then plays it, across a year boundary', () => {
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
    expect(months.map((month) => upcomingBallparkRules(ballpark, month))).toEqual([ballpark.scheduledRules, null, null])
  })

  it('plans the scheduled rules while they are ahead, and the rules in effect once they apply or when none are', () => {
    const ballpark: BallparkSettings = {
      ...DEFAULT_TOWN_VENUES.ballpark,
      rules: { pitchCount: 5, difficulty: 'normal' },
      scheduledRules: { fromMonth: '2026-12', rules: { pitchCount: 8, difficulty: 'hard' } },
    }
    expect(plannedBallparkRules(ballpark, '2026-11')).toEqual(ballpark.scheduledRules!.rules)
    expect(plannedBallparkRules(ballpark, '2027-01')).toEqual(ballpark.scheduledRules!.rules)
    expect(plannedBallparkRules({ ...ballpark, scheduledRules: undefined }, '2026-11')).toEqual(ballpark.rules)
  })
})
