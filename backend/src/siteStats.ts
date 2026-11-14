import type { GuestbookStatus } from './guestbook.js'
import { rankingDay, rankingWeek, type TownLayout } from './town.js'
import { boundedInteger, invalidInput } from './validation.js'

// The admin's usage statistics: anonymous daily totals only. Nothing here may identify a visitor or link two counts to
// one person, so a count holds a day, an event, and at most the id of a public resident.

/** Everything the town counts. A fixed list, so nobody can write anything else into the table. */
export const siteEvents = [
  'entered-town',
  'character-finished',
  'first-talk',
  'resident-talk',
  'guestbook-opened',
  'contact-opened',
  'linkedin-opened',
  'map-opened',
  'photo-taken',
  'ballpark-entered',
] as const
export type SiteEvent = (typeof siteEvents)[number]

/** The one event that names a resident; `subject` means nothing on any other. */
export const residentTalkEvent: SiteEvent = 'resident-talk'
const defaultStatsDays = 30
const maximumStatsDays = 365
const dayMilliseconds = 24 * 60 * 60 * 1000

/** A range of KST days, both included. */
export interface StatsRange {
  from: string
  to: string
  days: number
}

/** One event's total for a KST day; `subject` is a resident's id for the event that names one, otherwise empty. */
export interface SiteEventCount {
  day: string
  event: string
  subject: string
  count: number
}

/** How many guestbook notes of a status were written on a KST day. */
export interface GuestbookDayCount {
  day: string
  status: GuestbookStatus
  count: number
}

/** A ranked game's runs started and records held in a KST week, its season, named by its Monday. */
export interface GameWeekCount {
  week: string
  runs: number
  records: number
}

/** What a request asks to count, or `null` for anything but a listed event with the subject that event takes. */
export function parseSiteEvent(input: Record<string, unknown> | null): { event: SiteEvent; subject: string } | null {
  if (!input || !(siteEvents as readonly unknown[]).includes(input.event)) return null
  const event = input.event as SiteEvent
  const subject = input.subject
  if (event === residentTalkEvent) return typeof subject === 'string' ? { event, subject } : null
  return subject === undefined ? { event, subject: '' } : null
}

/** A subject must be a resident of the town, so what a stranger sends can never become a row of free text. */
export function isTownResident(town: Pick<TownLayout, 'residents'> | null, id: string): boolean {
  return town?.residents.some((resident) => resident.id === id) ?? false
}

/** `?days=`, a whole number of days; omitted means thirty. */
export function parseStatsDays(value: string | null): number {
  if (value === null) return defaultStatsDays
  if (!/^[0-9]{1,3}$/u.test(value)) throw invalidInput(`days must be a whole number from 1 to ${maximumStatsDays}`)
  return boundedInteger(Number(value), 'days', 1, maximumStatsDays)
}

/** The `days` KST days ending with the one `now` falls on. */
export function statsRange(days: number, now: number): StatsRange {
  const to = rankingDay(new Date(now).toISOString())
  const from = new Date(Date.parse(`${to}T00:00:00.000Z`) - (days - 1) * dayMilliseconds).toISOString().slice(0, 10)
  return { from, to, days }
}

/** The seasons with a day in the range, newest first as they came: a year of weeks is too many to list each time. */
export function weeksInRange(weeks: readonly GameWeekCount[], range: StatsRange): GameWeekCount[] {
  const firstWeek = rankingWeek(Date.parse(`${range.from}T00:00:00+09:00`))
  return weeks.filter(({ week }) => week >= firstWeek)
}

/** `totals` with `count` added under `key`. */
export function addToTotal(totals: Map<string, number>, key: string, count: number): void {
  totals.set(key, (totals.get(key) ?? 0) + count)
}

/** Each day's total per event, over all its subjects. */
export function dailyEventTotals(counts: readonly SiteEventCount[]) {
  const totals = new Map<string, number>()
  counts.forEach(({ day, event, count }) => addToTotal(totals, `${day}|${event}`, count))
  return [...totals]
    .map(([key, count]) => {
      const [day = '', event = ''] = key.split('|')
      return { day, event, count }
    })
    .sort((left, right) => left.day.localeCompare(right.day) || left.event.localeCompare(right.event))
}

/**
 * Conversations per resident, most first: every resident of the town, also one nobody has talked to, and a resident
 * since removed, whose `name` is `null`.
 */
export function residentTotals(counts: readonly SiteEventCount[], residents: TownLayout['residents']) {
  const totals = new Map<string, number>(residents.map(({ id }) => [id, 0]))
  const names = new Map(residents.map(({ id, name }) => [id, name]))
  const talks = counts.filter(({ event }) => event === residentTalkEvent)
  talks.forEach(({ subject, count }) => addToTotal(totals, subject, count))
  return [...totals]
    .map(([id, conversations]) => ({ id, name: names.get(id) ?? null, conversations }))
    .sort((left, right) => right.conversations - left.conversations || left.id.localeCompare(right.id))
}

/** The notes of the range, by status and by day; only what is still stored, so a deleted note no longer counts. */
export function guestbookTotals(notes: readonly GuestbookDayCount[]) {
  const byStatus: Record<GuestbookStatus, number> = { pending: 0, approved: 0 }
  const byDay = new Map<string, number>()
  notes.forEach(({ day, status, count }) => {
    byStatus[status] += count
    addToTotal(byDay, day, count)
  })
  return { byStatus, byDay: [...byDay].map(([day, count]) => ({ day, count })).sort(dayOrder) }
}

export function dayOrder(left: { day: string }, right: { day: string }): number {
  return left.day.localeCompare(right.day)
}
