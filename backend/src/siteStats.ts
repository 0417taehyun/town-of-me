import type { GuestbookStatus } from './guestbook.js'

// The admin's usage statistics: anonymous daily totals only. Nothing here may identify a visitor or link two counts to
// one person, so a count holds a day, an event, and at most the id of a public resident.

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

/** A ranked game's runs started and records held in a KST month, its season. */
export interface GameMonthCount {
  month: string
  runs: number
  records: number
}
