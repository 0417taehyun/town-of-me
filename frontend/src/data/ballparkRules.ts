import type { BallparkRules, BallparkSettings, ScheduledBallparkRules } from './models'

// Mirrors rankingMonth and effectiveBallparkRules in backend/src/town.ts, which decides the rules in effect.

// Korea keeps no daylight saving time, so a fixed offset gives the KST calendar month.
export const kstOffsetMilliseconds = 9 * 60 * 60 * 1000

/** The KST ranking month, `YYYY-MM`, that `date` falls in, whatever the device's time zone. */
export function rankingMonth(date: Date) {
  return new Date(date.getTime() + kstOffsetMilliseconds).toISOString().slice(0, 7)
}

/** The ranking month after a `YYYY-MM` month: the only month an admin schedules new rules for. */
export function nextRankingMonth(month: string) {
  const [year, monthNumber] = month.split('-').map(Number)
  // Date.UTC counts months from 0, so the 1-based month number is already the month after.
  return new Date(Date.UTC(year, monthNumber, 1)).toISOString().slice(0, 7)
}

/** When the ranking month `month` ends: midnight KST as the next month starts. */
export function seasonEndsAt(month: string) {
  return Date.parse(`${nextRankingMonth(month)}-01T00:00:00.000Z`) - kstOffsetMilliseconds
}

/** The ranking month before a `YYYY-MM` month. */
export function previousRankingMonth(month: string) {
  const [year, monthNumber] = month.split('-').map(Number)
  return new Date(Date.UTC(year, monthNumber - 2, 1)).toISOString().slice(0, 7)
}

/** The rules played in `month`: a schedule takes over from its own month on, since `YYYY-MM` months sort as text. */
export function effectiveBallparkRules(ballpark: BallparkSettings, month: string): BallparkRules {
  const scheduled = ballpark.scheduledRules
  return scheduled && scheduled.fromMonth <= month ? scheduled.rules : ballpark.rules
}

/** The scheduled change still ahead of `month`, if any; from its own month on, it is the rules in effect instead. */
export function upcomingBallparkRules(ballpark: BallparkSettings, month: string): ScheduledBallparkRules | null {
  const scheduled = ballpark.scheduledRules
  return scheduled && scheduled.fromMonth > month ? scheduled : null
}

/** The rules the ballpark is headed for: the scheduled change still ahead of `month`, or else the rules in effect. */
export function plannedBallparkRules(ballpark: BallparkSettings, month: string): BallparkRules {
  return upcomingBallparkRules(ballpark, month)?.rules ?? effectiveBallparkRules(ballpark, month)
}
