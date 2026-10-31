import type { BallparkRules, BallparkSettings } from './models'

// Mirrors rankingMonth and effectiveBallparkRules in backend/src/town.ts, which decides the rules in effect.

// Korea keeps no daylight saving time, so a fixed offset gives the KST calendar month.
const kstOffsetMilliseconds = 9 * 60 * 60 * 1000

/** The KST ranking month, `YYYY-MM`, that `date` falls in, whatever the device's time zone. */
export function rankingMonth(date: Date) {
  return new Date(date.getTime() + kstOffsetMilliseconds).toISOString().slice(0, 7)
}

/** The rules played in `month`: a schedule takes over from its own month on, since `YYYY-MM` months sort as text. */
export function effectiveBallparkRules(ballpark: BallparkSettings, month: string): BallparkRules {
  const scheduled = ballpark.scheduledRules
  return scheduled && scheduled.fromMonth <= month ? scheduled.rules : ballpark.rules
}
