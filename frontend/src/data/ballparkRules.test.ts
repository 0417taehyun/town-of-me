import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  effectiveBallparkRules,
  isRankingWeek,
  nextRankingWeek,
  plannedBallparkRules,
  previousRankingWeek,
  rankingWeek,
  seasonEndsAt,
  upcomingBallparkRules,
} from './ballparkRules'
import { DEFAULT_TOWN_VENUES, type BallparkSettings } from './models'

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('ballpark ranking weeks', () => {
  it('turns the week at midnight on Monday in Korea, whatever the device time zone', () => {
    // Sunday 23:59:59 and Monday 00:00 KST, a Sunday mid-week by UTC, and the Monday that starts 2027's first week.
    const instants = ['2026-11-08T14:59:59Z', '2026-11-08T15:00:00Z', '2026-11-15T03:00:00Z', '2027-01-03T15:00:00Z']
    // Seoul catches an offset applied twice, Los Angeles one never applied, when the week is read from local time.
    const timeZones = ['UTC', 'Asia/Seoul', 'America/Los_Angeles']
    const weeksOnDeviceIn = (timeZone: string) => {
      vi.stubEnv('TZ', timeZone)
      return instants.map((instant) => rankingWeek(new Date(instant)))
    }
    expect(timeZones.map(weeksOnDeviceIn)).toEqual(
      timeZones.map(() => ['2026-11-02', '2026-11-09', '2026-11-09', '2027-01-04']),
    )
  })

  it('steps a week either way across a month and a year, and ends a season as the next Monday starts in Korea', () => {
    const timeZones = ['UTC', 'Asia/Seoul', 'America/Los_Angeles']
    const neighborsOnDeviceIn = (timeZone: string) => {
      vi.stubEnv('TZ', timeZone)
      return ['2026-11-09', '2026-11-30', '2026-12-28'].map((week) => [
        previousRankingWeek(week),
        nextRankingWeek(week),
      ])
    }
    expect(timeZones.map(neighborsOnDeviceIn)).toEqual(
      timeZones.map(() => [
        ['2026-11-02', '2026-11-16'],
        ['2026-11-23', '2026-12-07'],
        ['2026-12-21', '2027-01-04'],
      ]),
    )
    expect(seasonEndsAt('2026-11-09')).toBe(Date.parse('2026-11-15T15:00:00.000Z'))
  })

  it('takes only the date of a real Monday for a week', () => {
    const values = ['2026-11-09', '2026-11-10', '2026-11', '2026-02-30', '2026-13-01', '']
    expect(values.map(isRankingWeek)).toEqual([true, false, false, false, false, false])
  })

  it('plays the rules in effect and announces the schedule until its week, then plays it, across a year boundary', () => {
    const ballpark: BallparkSettings = {
      ...DEFAULT_TOWN_VENUES.ballpark,
      rules: { pitchCount: 5, difficulty: 'normal' },
      scheduledRules: { fromWeek: '2026-12-28', rules: { pitchCount: 8, difficulty: 'hard' } },
    }
    const weeks = ['2026-12-21', '2026-12-28', '2027-01-04']
    expect(weeks.map((week) => effectiveBallparkRules(ballpark, week))).toEqual([
      ballpark.rules,
      ballpark.scheduledRules!.rules,
      ballpark.scheduledRules!.rules,
    ])
    expect(effectiveBallparkRules({ ...ballpark, scheduledRules: undefined }, '2027-01-04')).toEqual(ballpark.rules)
    expect(weeks.map((week) => upcomingBallparkRules(ballpark, week))).toEqual([ballpark.scheduledRules, null, null])
  })

  it('plans the scheduled rules while they are ahead, and the rules in effect once they apply or when none are', () => {
    const ballpark: BallparkSettings = {
      ...DEFAULT_TOWN_VENUES.ballpark,
      rules: { pitchCount: 5, difficulty: 'normal' },
      scheduledRules: { fromWeek: '2026-12-28', rules: { pitchCount: 8, difficulty: 'hard' } },
    }
    expect(plannedBallparkRules(ballpark, '2026-12-21')).toEqual(ballpark.scheduledRules!.rules)
    expect(plannedBallparkRules(ballpark, '2027-01-04')).toEqual(ballpark.scheduledRules!.rules)
    expect(plannedBallparkRules({ ...ballpark, scheduledRules: undefined }, '2026-12-21')).toEqual(ballpark.rules)
  })
})
