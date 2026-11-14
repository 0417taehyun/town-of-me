import { recordNumber } from '../baseball/board/boardView'
import type { PlayedLink, PlayedRecord, PlayedRun, PlaysPage, RecordAction } from '../data/boardReviewApi'
import { rankingWeek } from '../data/ballparkRules'
import { LeaderboardRequestError } from '../data/leaderboardApi'
import { RANKING_WEEK_PATTERN } from '../data/models'
import { normalizeLinkedInProfileUrl } from '../data/linkedInProfile'
import type { AppLanguage } from '../i18n/language'
import type { BoardReviewCopy } from './boardReviewCopy'

// What the derby plays dialog works out from the server's answers. The server decides the order and every place;
// nothing here ranks or sorts again.

/**
 * Someone changed the record since the list loaded (`409`), or its visitor deleted their records (`404`), so the list
 * must reload before the admin acts on it.
 */
export function isStaleBoardReview(error: unknown) {
  return error instanceof LeaderboardRequestError && (error.status === 409 || error.status === 404)
}

/** The list with one more page after it. A visitor already listed keeps the record read first; `reported` came once. */
export function withNextPage(shown: PlaysPage, next: PlaysPage): PlaysPage {
  // A page asked for before the admin picked another week belongs to no list any more.
  if (shown.season !== next.season) return shown
  const known = new Set(shown.records.map(({ id }) => id))
  return {
    ...shown,
    runs: [...shown.runs, ...next.runs],
    records: [...shown.records, ...next.records.filter(({ id }) => !known.has(id))],
    nextCursor: next.nextCursor,
    unreadable: shown.unreadable + next.unreadable,
  }
}

/**
 * The list with an action's answer in place, so a second action on the record names the version the first left
 * instead of being refused as stale. A report resolved there leaves the block of reports once none is open.
 */
export function withRecord(shown: PlaysPage, record: PlayedRecord): PlaysPage {
  const replace = (records: readonly PlayedRecord[]) =>
    records.map((current) => (current.id === record.id ? record : current))
  return {
    ...shown,
    records: replace(shown.records),
    reported: replace(shown.reported).filter(({ reports }) => reports.length > 0),
  }
}

/**
 * Each run with its visitor's record, which shows in full beside the visitor's newest run only: a visitor who played
 * twenty times does not repeat their record's buttons twenty times.
 */
export function playRows(page: Pick<PlaysPage, 'runs' | 'records'>) {
  const records = new Map(page.records.map((record) => [record.visitor, record]))
  // Oldest first, so each visitor's entry ends as their newest run.
  const newestRun = new Map([...page.runs].reverse().map((run) => [run.visitor, run.id]))
  return page.runs.map((run) => ({
    run,
    record: records.get(run.visitor) ?? null,
    newest: newestRun.get(run.visitor) === run.id,
  }))
}

/** Which actions a record's state allows, so the dialog never offers one the server would refuse. */
export function recordChoices(record: PlayedRecord) {
  const named = record.name !== null
  return {
    remove: !record.disqualified,
    restore: record.disqualified,
    hideName: named && record.nameStatus === 'shown',
    showName: named && record.nameStatus === 'rejected',
    hideAppearance: record.appearancePublic && !record.takedown,
    showAppearance: !record.appearancePublic && !record.takedown,
    removeLink: record.linkedIn !== null,
    takedown: !record.takedown,
  }
}

/** The buttons of a record's lesser actions, in the order its card shows them. Removing and taking down have their own. */
export function recordButtons(record: PlayedRecord, copy: BoardReviewCopy) {
  const choices = recordChoices(record)
  const buttons: Array<{ shown: boolean; label: string; action: RecordAction }> = [
    { shown: choices.restore, label: copy.restore, action: { kind: 'restoration' } },
    { shown: choices.hideName, label: copy.hideName, action: { kind: 'name', public: false } },
    { shown: choices.showName, label: copy.showName, action: { kind: 'name', public: true } },
    { shown: choices.hideAppearance, label: copy.hideAppearance, action: { kind: 'appearance', public: false } },
    { shown: choices.showAppearance, label: copy.showAppearance, action: { kind: 'appearance', public: true } },
    { shown: choices.removeLink, label: copy.removeLink, action: { kind: 'linkedin-removal' } },
  ]
  return buttons.filter((button) => button.shown)
}

/** A link's removal, or a takedown, with the box ticked that also blocks the profile from every record. */
export function withLinkBlock(action: RecordAction, block: boolean): RecordAction {
  const blockable = action.kind === 'linkedin-removal' || action.kind === 'takedown'
  return blockable && block ? { ...action, blockLinkedIn: true } : action
}

export function deletesLink(action: RecordAction) {
  if (action.kind === 'linkedin-removal') return true
  return action.kind === 'report-resolution' && action.target === 'link' && action.resolution === 'removed'
}

/**
 * What the admin must confirm about a record first: removing it, which moves the next record up at once; what deletes
 * something for good (a link, a record's name and link); and showing a name that was refused. Each says which record,
 * by number too, since a visitor can name themselves anything.
 */
export function actionQuestion(record: PlayedRecord, action: RecordAction, copy: BoardReviewCopy) {
  const number = recordNumber(record.id)
  const name = record.name ?? copy.noName
  if (action.kind === 'disqualification') return copy.confirmRemove(name, number)
  if (action.kind === 'takedown') return copy.confirmTakedown(name, number, action.blockLinkedIn === true)
  if (deletesLink(action)) {
    return copy.confirmRemoveLink(name, number, action.kind === 'linkedin-removal' && action.blockLinkedIn === true)
  }
  if (action.kind === 'name' && action.public) return copy.confirmShowName(name, number)
  return null
}

/** Where a record stands: its place, the place it would take if posted, or removed from the board. */
export function placeText(record: PlayedRecord, copy: BoardReviewCopy) {
  if (record.rank === null) return copy.removed
  return record.listed ? copy.place(record.rank) : copy.wouldBe(record.rank)
}

/** A mark the server added after this page was built still shows, as the server names it. */
export function flagLabel(flag: string, copy: BoardReviewCopy) {
  return (copy.flags as Readonly<Record<string, string>>)[flag] ?? flag
}

/** What the admin needs said about the marks that are not about the swings themselves, one line each. */
export function flagNotes(flags: readonly string[], copy: BoardReviewCopy): string[] {
  const notes: Readonly<Record<string, string>> = copy.flagNotes
  return flags.flatMap((flag) => notes[flag] ?? [])
}

/** A run's score, or a dash for one that never got a result. */
export function runScore(run: PlayedRun) {
  return run.homeRuns === null || run.totalDistanceDm === null
    ? null
    : { homeRuns: run.homeRuns, totalDistanceDm: run.totalDistanceDm }
}

export function numberText(value: number | null, fractionDigits: number) {
  return value === null ? '—' : value.toFixed(fractionDigits)
}

export function reviewTime(time: string, language: AppLanguage) {
  return new Intl.DateTimeFormat(language, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(time))
}

/**
 * The season a date field names, the KST week of the picked day, or `null`: a date field reads empty until it is
 * whole, and a board to come does not exist yet.
 */
export function pickedSeason(value: string, currentSeason: string): string | null {
  const day = Date.parse(`${value}T00:00:00+09:00`)
  // The week's pattern is that of any whole date; half of one may still parse.
  if (!RANKING_WEEK_PATTERN.test(value) || Number.isNaN(day)) return null
  const season = rankingWeek(new Date(day))
  return season <= currentSeason ? season : null
}

/**
 * How a link reads: its decoded id as text, and an address to open only if it is a plain LinkedIn profile. Anything
 * else shows whole, since its id would be a slice of who knows what.
 */
export function linkView(link: PlayedLink) {
  const href = normalizeLinkedInProfileUrl(link.profileUrl)
  return { text: href ? link.profileId : link.profileUrl, href, encoded: link.encoded }
}
