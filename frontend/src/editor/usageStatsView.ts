import type { UsageStats } from '../data/usageStatsApi'
import type { AppLanguage } from '../i18n/language'

// What the usage statistics dialog shows, worked out from the totals. A step here is only a total per day: nothing
// follows anyone from one step to the next, so nothing here may read as a share of people.

/** The steps a visit can take, in order. Notes written come from the guestbook itself rather than a counted event. */
export const STEPS = ['entered-town', 'character-finished', 'first-talk', 'guestbook-opened', 'notes-written'] as const
export type Step = (typeof STEPS)[number]

const DAY_MILLISECONDS = 24 * 60 * 60 * 1000

/** Every KST day from `from` to `to`, both `YYYY-MM-DD` and both included. */
export function daysBetween(from: string, to: string) {
  const start = Date.parse(`${from}T00:00:00.000Z`)
  const days = Math.round((Date.parse(`${to}T00:00:00.000Z`) - start) / DAY_MILLISECONDS) + 1
  return Array.from({ length: Math.max(days, 0) }, (_day, index) =>
    new Date(start + index * DAY_MILLISECONDS).toISOString().slice(0, 10),
  )
}

/** One row per day of the range, also the days the server has no count for, so a quiet day shows as a gap. */
export function dailyRows({ range, daily, guestbook }: UsageStats) {
  const totals = new Map<string, number>([
    ...daily.map(({ day, event, count }): [string, number] => [`${day}|${event}`, count]),
    ...guestbook.byDay.map(({ day, count }): [string, number] => [`${day}|notes-written`, count]),
  ])
  return daysBetween(range.from, range.to).map((day) => ({
    day,
    counts: Object.fromEntries(STEPS.map((step) => [step, totals.get(`${day}|${step}`) ?? 0])) as Record<Step, number>,
  }))
}

export type DailyRow = ReturnType<typeof dailyRows>[number]

export function stepTotal(rows: readonly DailyRow[], step: Step) {
  return rows.reduce((sum, row) => sum + row.counts[step], 0)
}

/** An event's total over the range, all its subjects included. */
export function eventTotal({ daily }: UsageStats, event: string) {
  return daily.filter((row) => row.event === event).reduce((sum, row) => sum + row.count, 0)
}

/** Whether there is nothing to show yet. Residents always list, so they say nothing about it. */
export function isEmptyStats({ daily, guestbook, derby }: UsageStats) {
  return daily.length === 0 && guestbook.byDay.length === 0 && derby.length === 0
}

/** The top of a shared axis: small counts as they are, since each day is a whole number; larger ones round up to 1, 2, or 5 × 10ⁿ. */
export function axisTop(largest: number) {
  if (largest <= 5) return Math.max(largest, 1)
  const power = 10 ** Math.floor(Math.log10(largest))
  const step = [1, 2, 5, 10].find((multiple) => multiple * power >= largest) ?? 10
  return step * power
}

/** The highest count on any step's day, which every chart's axis shares so their heights compare. */
export function largestDailyCount(rows: readonly DailyRow[]) {
  return Math.max(0, ...rows.flatMap(({ counts }) => STEPS.map((step) => counts[step])))
}

/** A `YYYY-MM-DD` day as words; it is a KST day, so it must not move with the device's time zone. */
export function dayLabel(day: string, language: AppLanguage) {
  return new Intl.DateTimeFormat(language, { month: 'short', day: 'numeric', timeZone: 'UTC' }).format(
    Date.parse(`${day}T00:00:00.000Z`),
  )
}
