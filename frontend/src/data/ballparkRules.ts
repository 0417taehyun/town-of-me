import { RANKING_WEEK_PATTERN, type BallparkRules, type BallparkSettings, type ScheduledBallparkRules } from './models'

// Mirrors rankingWeek, nextRankingWeek, previousRankingWeek, rankingWeekInput, rankingWeekStart, and
// effectiveBallparkRules in backend/src/town.ts, which decides the rules in effect.

// Korea keeps no daylight saving time, so a fixed offset gives the KST calendar day and week.
export const kstOffsetMilliseconds = 9 * 60 * 60 * 1000
export const dayMilliseconds = 24 * 60 * 60 * 1000
const weekMilliseconds = 7 * dayMilliseconds

/**
 * The KST ranking week that `date` falls in, named by its Monday, `YYYY-MM-DD`, whatever the device's time zone: a
 * week runs from Monday 00:00 KST to the next Monday.
 */
export function rankingWeek(date: Date) {
  const kstTime = new Date(date.getTime() + kstOffsetMilliseconds)
  // getUTCDay counts from Sunday, so this is how many days the KST day is past its Monday.
  const daysSinceMonday = (kstTime.getUTCDay() + 6) % 7
  return new Date(kstTime.getTime() - daysSinceMonday * dayMilliseconds).toISOString().slice(0, 10)
}

/** When the ranking week `week` starts: 00:00 KST on its Monday, in epoch ms. */
export function rankingWeekStart(week: string) {
  return Date.parse(`${week}T00:00:00.000Z`) - kstOffsetMilliseconds
}

/** Whether `value` names a ranking week: the `YYYY-MM-DD` of a real Monday, as the server accepts one. */
export function isRankingWeek(value: string) {
  // A day that is not on the calendar (02-30) rolls over to another date or does not parse, so it fails this too.
  return RANKING_WEEK_PATTERN.test(value) && rankingWeek(new Date(rankingWeekStart(value))) === value
}

/** The ranking week after `week`: the only week an admin schedules new rules for. */
export function nextRankingWeek(week: string) {
  return rankingWeek(new Date(rankingWeekStart(week) + weekMilliseconds))
}

/** When the ranking week `week` ends: midnight KST as the next Monday starts. */
export function seasonEndsAt(week: string) {
  return rankingWeekStart(week) + weekMilliseconds
}

/** The ranking week before `week`. */
export function previousRankingWeek(week: string) {
  return rankingWeek(new Date(rankingWeekStart(week) - weekMilliseconds))
}

/** The rules played in `week`: a schedule takes over from its own week on, since weeks sort as text. */
export function effectiveBallparkRules(ballpark: BallparkSettings, week: string): BallparkRules {
  const scheduled = ballpark.scheduledRules
  return scheduled && scheduled.fromWeek <= week ? scheduled.rules : ballpark.rules
}

/** The scheduled change still ahead of `week`, if any; from its own week on, it is the rules in effect instead. */
export function upcomingBallparkRules(ballpark: BallparkSettings, week: string): ScheduledBallparkRules | null {
  const scheduled = ballpark.scheduledRules
  return scheduled && scheduled.fromWeek > week ? scheduled : null
}

/** The rules the ballpark is headed for: the scheduled change still ahead of `week`, or else the rules in effect. */
export function plannedBallparkRules(ballpark: BallparkSettings, week: string): BallparkRules {
  return upcomingBallparkRules(ballpark, week)?.rules ?? effectiveBallparkRules(ballpark, week)
}
