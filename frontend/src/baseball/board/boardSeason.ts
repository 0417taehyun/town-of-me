import { kstOffsetMilliseconds, nextRankingMonth, previousRankingMonth } from '../../data/ballparkRules'

// The board's seasons, KST calendar months written `YYYY-MM`, as the page shows and moves between them.

const dayMilliseconds = 24 * 60 * 60 * 1000
/** How far back the season buttons go: a year of final boards. */
export const PAST_SEASONS_SHOWN = 12

/** The season a page's query names (`?season=YYYY-MM`), or `null` for this month's board; one still to come is too. */
export function requestedSeason(search: string, currentSeason: string): string | null {
  const season = new URLSearchParams(search).get('season')
  if (!season || !/^\d{4}-(0[1-9]|1[0-2])$/u.test(season) || season >= currentSeason) return null
  return season
}

/** The oldest season the buttons reach from `currentSeason`. */
export function oldestShownSeason(currentSeason: string) {
  return Array.from({ length: PAST_SEASONS_SHOWN }).reduce<string>(
    (season) => previousRankingMonth(season),
    currentSeason,
  )
}

/**
 * Days until a season ends at `endsAt`, counted in KST calendar days as a D-day is: 1 all through its last day, 30 on
 * the first day of a 30-day month, whatever the device's time zone.
 */
export function daysUntilSeasonEnds(endsAt: number, now: number) {
  const kstDay = (time: number) => Math.floor((time + kstOffsetMilliseconds) / dayMilliseconds)
  return Math.max(0, kstDay(endsAt) - kstDay(now))
}

/** When `season` ends: midnight KST as the next month starts. */
export function seasonEndsAt(season: string) {
  return Date.parse(`${nextRankingMonth(season)}-01T00:00:00.000Z`) - kstOffsetMilliseconds
}

/** The board's address for `season`, or for this month's board. */
export function seasonSearch(season: string | null) {
  return season ? `?season=${season}` : ''
}
