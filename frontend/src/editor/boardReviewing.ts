import { useCallback } from 'react'
import { recordNumber } from '../baseball/board/boardView'
import {
  DISMISSED_RUNS_LIMIT,
  fetchRecordWarnings,
  REVIEW_KINDS,
  seasonPattern,
  type BoardReviewData,
  type NeighbourName,
  type RecordAction,
  type ReviewedEntry,
  type ReviewedLink,
  type ReviewItem,
  type ReviewWarning,
} from '../data/boardReviewApi'
import { LeaderboardRequestError } from '../data/leaderboardApi'
import { normalizeLinkedInProfileUrl } from '../data/linkedInProfile'
import { useRetryableLoad } from '../hooks/useRetryableLoad'
import type { AppLanguage } from '../i18n/language'
import type { BoardReviewCopy } from './boardReviewCopy'

// What the board review dialog works out from the server's answers. The server decides the queue's order and kinds;
// nothing here ranks or sorts them again.

/** A search on a big board stops here: the admin narrows it rather than scroll through hundreds of cards. */
export const FOUND_RECORDS_SHOWN = 20
const neighbourDistance = 3

/**
 * Someone changed the record since the list loaded (`409`), or its visitor deleted their records (`404`), so the list
 * must reload before the admin acts on it.
 */
export function isStaleBoardReview(error: unknown) {
  return error instanceof LeaderboardRequestError && (error.status === 409 || error.status === 404)
}

/** The queue under its kinds, keeping the server's order, and without the kinds nothing waits in. */
export function reviewGroups(items: readonly ReviewItem[]) {
  return REVIEW_KINDS.map((kind) => ({ kind, items: items.filter((item) => item.kind === kind) })).filter(
    (group) => group.items.length > 0,
  )
}

/** What identifies an item while it is busy: its record, or for a visitor with none, their held run. */
export function itemKey(item: ReviewItem) {
  return item.entry?.id ?? item.runs[0]?.id ?? ''
}

/**
 * Per season in the queue, the held runs of visitors with no history, which the bulk action names one by one: a
 * dismissal cannot be undone, so it takes only what the admin sees listed. A bigger flood takes another click.
 */
export function noHistoryRuns(items: readonly ReviewItem[]) {
  const held = items.filter((item) => item.newVisitor && item.runs.length > 0)
  const seasons = [...new Set(held.map((item) => item.season))]
  return seasons.map((season) => {
    const ofSeason = held.filter((item) => item.season === season)
    return {
      season,
      runIds: ofSeason.flatMap((item) => item.runs.map((run) => run.id)).slice(0, DISMISSED_RUNS_LIMIT),
      keys: ofSeason.map(itemKey),
    }
  })
}

export function searchForm(text: string) {
  return text.normalize('NFKC').trim().toLowerCase()
}

/**
 * The records that match, in the board's order and at most `FOUND_RECORDS_SHOWN`, how many there were, and whether they
 * matched by number. A record number is the id's first characters, and when any id starts with the query only those
 * records count: a visitor can name themselves another record's number, and the admin must not act on the impostor.
 * Otherwise a name matches anywhere within.
 */
export function findRecords(records: readonly ReviewedEntry[], query: string) {
  const form = searchForm(query)
  if (form === '') return { shown: [], total: 0, byNumber: false }
  const byNumber = records.filter((record) => record.id.startsWith(form))
  const matches =
    byNumber.length > 0
      ? byNumber
      : records.filter((record) => record.name !== null && searchForm(record.name).includes(form))
  return { shown: matches.slice(0, FOUND_RECORDS_SHOWN), total: matches.length, byNumber: byNumber.length > 0 }
}

/** The names around a found record's place in the public order, as the queue gives them. */
export function boardNeighbours(records: readonly ReviewedEntry[], entry: ReviewedEntry): NeighbourName[] {
  const publicRecords = records.filter((record) => record.listed && record.reviewStatus !== 'disqualified')
  const index = publicRecords.findIndex((record) => record.id === entry.id)
  if (index < 0) return []
  const start = Math.max(0, index - neighbourDistance)
  return publicRecords
    .slice(start, index + neighbourDistance + 1)
    .map((record, offset) => ({ rank: start + offset + 1, name: record.name }))
    .filter(({ rank }) => rank !== index + 1)
}

/** The warnings of the records a search found outside the queues, read again whenever they change. */
export function useRecordWarnings(season: string | null, recordIds: string) {
  const load = useCallback(() => fetchRecordWarnings(season, recordIds), [season, recordIds])
  return useRetryableLoad(load)
}

/** The record's item in a queue the dialog read, which brings its own warnings, reports, and runs. */
export function queuedItem(entry: ReviewedEntry, data: BoardReviewData) {
  return [...data.seasonQueue, ...data.queue].find((item) => item.entry?.id === entry.id) ?? null
}

/** A found record as a card shows it: its queue item, or the record with the warnings read for it, once they are. */
export function foundItem(
  entry: ReviewedEntry,
  data: BoardReviewData,
  warnings: Readonly<Record<string, ReviewWarning[]>> | undefined,
): ReviewItem {
  return (
    queuedItem(entry, data) ?? {
      kind: null,
      season: entry.season,
      acceptable: false,
      newVisitor: false,
      visitor: null,
      entry,
      runs: [],
      reports: [],
      warnings: warnings?.[entry.id] ?? null,
      neighbours: boardNeighbours(data.records, entry),
    }
  )
}

/**
 * The names around the record with its own in place, so names that read as a sentence together are seen together.
 * The record's own line is `self`.
 */
export function neighbourLines(item: ReviewItem) {
  const entry = item.entry
  const lines = item.neighbours.map((neighbour) => ({ ...neighbour, self: false }))
  if (!entry || entry.rank === null || lines.length === 0) return lines
  return [...lines, { rank: entry.rank, name: entry.name, self: true }].sort((left, right) => left.rank - right.rank)
}

/** Which actions a record's state allows, so the dialog never offers one the server would refuse. */
export function recordChoices(entry: ReviewedEntry) {
  const onBoard = entry.reviewStatus !== 'disqualified'
  const named = entry.name !== null
  return {
    approveName: onBoard && named && entry.nameStatus !== 'approved',
    rejectName: onBoard && named && entry.nameStatus !== 'rejected',
    approveRecord: onBoard && entry.reviewStatus === 'pending' && entry.nameStatus !== 'pending',
    disqualify: onBoard,
    restore: !onBoard,
    verifyLink: entry.linkedIn !== null && entry.linkedIn.status !== 'approved',
    rejectLink: entry.linkedIn !== null,
    hideAppearance: entry.appearancePublic,
    showAppearance: !entry.appearancePublic && !entry.takedown,
    takedown: !entry.takedown,
  }
}

/** The buttons of a record's plain actions, in the order the card shows them. Taking it down has its own option. */
export function recordButtons(entry: ReviewedEntry, copy: BoardReviewCopy) {
  const choices = recordChoices(entry)
  const buttons: Array<{ shown: boolean; label: string; action: RecordAction; tone: 'primary' | 'plain' | 'danger' }> =
    [
      {
        shown: choices.approveName,
        label: copy.approveName,
        action: { kind: 'approval', name: 'approve' },
        tone: 'primary',
      },
      { shown: choices.approveRecord, label: copy.approveRecord, action: { kind: 'approval' }, tone: 'primary' },
      {
        shown: choices.rejectName,
        label: copy.rejectName,
        action: { kind: 'approval', name: 'reject' },
        tone: 'danger',
      },
      {
        shown: choices.verifyLink,
        label: copy.verifyLink,
        action: { kind: 'linkedin-review', decision: 'code-verified' },
        tone: 'plain',
      },
      {
        shown: choices.rejectLink,
        label: copy.rejectLink,
        action: { kind: 'linkedin-review', decision: 'reject' },
        tone: 'danger',
      },
      {
        shown: choices.hideAppearance,
        label: copy.hideAppearance,
        action: { kind: 'appearance', public: false },
        tone: 'plain',
      },
      {
        shown: choices.showAppearance,
        label: copy.showAppearance,
        action: { kind: 'appearance', public: true },
        tone: 'plain',
      },
      { shown: choices.restore, label: copy.restore, action: { kind: 'restoration' }, tone: 'plain' },
      { shown: choices.disqualify, label: copy.disqualify, action: { kind: 'disqualification' }, tone: 'danger' },
    ]
  return buttons.filter((button) => button.shown)
}

/**
 * What the admin must confirm about a record first: what deletes something for good (a link, a record's name and link),
 * what publishes a name that was refused, and disqualifying, which moves a statue at once. Each says which record, by
 * number too, since a visitor can name themselves anything. Dismissing a held run asks too, but it is not on a record.
 */
export function actionQuestion(entry: ReviewedEntry, action: RecordAction, copy: BoardReviewCopy) {
  const number = recordNumber(entry.id)
  const name = entry.name ?? copy.noName
  if (action.kind === 'disqualification') return copy.confirmDisqualify(name, number)
  if (action.kind === 'takedown') return copy.confirmTakedown(name, number, action.blockLinkedIn === true)
  if (deletesLink(action)) return copy.confirmRejectLink(name, number)
  if (action.kind === 'approval' && action.name === 'approve' && entry.nameStatus === 'rejected') {
    return copy.confirmRejectedName(name, number)
  }
  return null
}

export function deletesLink(action: RecordAction) {
  if (action.kind === 'linkedin-review') return action.decision === 'reject'
  return action.kind === 'report-resolution' && action.target === 'link' && action.resolution === 'removed'
}

export function warningText(warning: ReviewWarning, copy: BoardReviewCopy) {
  if (warning.kind === 'similar-name') return copy.similarName(warning.name)
  if (warning.kind === 'same-appearance') return copy.sameAppearance(warning.name)
  return copy.townLink
}

/** Each thing a card warns of once: the town's owner and their house can share a name, and many records have none. */
export function warningLines(warnings: readonly ReviewWarning[], copy: BoardReviewCopy) {
  return [...new Set(warnings.map((warning) => warningText(warning, copy)))]
}

/** A flag the server added after this page was built still shows, as the server names it. */
export function flagLabel(flag: string, copy: BoardReviewCopy) {
  return (copy.flags as Readonly<Record<string, string>>)[flag] ?? flag
}

export function numberText(value: number | null, fractionDigits: number) {
  return value === null ? '—' : value.toFixed(fractionDigits)
}

export function reviewTime(time: string, language: AppLanguage) {
  return new Intl.DateTimeFormat(language, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(time))
}

/** A month the board may have: a month field reads empty until it is whole, and a board to come does not exist yet. */
export function isPickableSeason(value: string, currentSeason: string) {
  return seasonPattern.test(value) && value <= currentSeason
}

/**
 * How a link reads: its decoded id as text, and an address to open only if it is a plain LinkedIn profile. Anything
 * else shows whole, since its id would be a slice of who knows what.
 */
export function linkView(link: ReviewedLink) {
  const href = normalizeLinkedInProfileUrl(link.profileUrl)
  return { text: href ? link.profileId : link.profileUrl, href, encoded: link.encoded }
}

export function replaceItemEntry(item: ReviewItem, entry: ReviewedEntry): ReviewItem {
  return item.entry?.id === entry.id ? { ...item, entry } : item
}

/**
 * The list with an action's answer applied until the reload arrives, so a second action on the record names the
 * version the first left instead of being refused as stale.
 */
export function withEntry(data: BoardReviewData, entry: ReviewedEntry): BoardReviewData {
  return {
    ...data,
    queue: data.queue.map((item) => replaceItemEntry(item, entry)),
    seasonQueue: data.seasonQueue.map((item) => replaceItemEntry(item, entry)),
    records: data.records.map((record) => (record.id === entry.id ? entry : record)),
  }
}

export function itemsWithoutRun(items: readonly ReviewItem[], runId: string) {
  return items
    .map((item) => ({ ...item, runs: item.runs.filter((run) => run.id !== runId) }))
    .filter((item) => item.entry !== null || item.runs.length > 0)
}

/** The list without a held run an action settled, until the reload arrives. */
export function withoutRun(data: BoardReviewData, runId: string): BoardReviewData {
  return { ...data, queue: itemsWithoutRun(data.queue, runId), seasonQueue: itemsWithoutRun(data.seasonQueue, runId) }
}
