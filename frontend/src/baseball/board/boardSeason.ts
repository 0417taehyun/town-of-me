import { dayMilliseconds, isRankingWeek, kstOffsetMilliseconds, previousRankingWeek } from '../../data/ballparkRules'

// The board's seasons, KST weeks written as their Monday's `YYYY-MM-DD`, as the page shows and moves between them.

/** How far back the season buttons go: twelve final boards. The hall of fame links to every older one. */
export const PAST_SEASONS_SHOWN = 12

/**
 * The season a page's query names (`?season=YYYY-MM-DD`, a Monday), or `null` for this week's board; one still to come
 * is too.
 */
export function requestedSeason(search: string, currentSeason: string): string | null {
  const season = new URLSearchParams(search).get('season')
  if (!season || !isRankingWeek(season) || season >= currentSeason) return null
  return season
}

/** The oldest season the buttons reach from `currentSeason`. */
export function oldestShownSeason(currentSeason: string) {
  return Array.from({ length: PAST_SEASONS_SHOWN }).reduce<string>(
    (season) => previousRankingWeek(season),
    currentSeason,
  )
}

/**
 * Days until a season ends at `endsAt`, counted in KST calendar days as a D-day is: 1 all through its last day, 7 on
 * its first, whatever the device's time zone.
 */
export function daysUntilSeasonEnds(endsAt: number, now: number) {
  const kstDay = (time: number) => Math.floor((time + kstOffsetMilliseconds) / dayMilliseconds)
  return Math.max(0, kstDay(endsAt) - kstDay(now))
}

/** The board's address for `season`, or for this week's board. */
export function seasonSearch(season: string | null) {
  return season ? `?season=${season}` : ''
}
