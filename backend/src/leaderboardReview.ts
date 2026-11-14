import type { DerbyInputLog, PitchResult, SwingEvent } from './derbyJudge/derbyScore.js'
import { swingPower } from './derbyJudge/judging.js'
import { DomainError } from './domain.js'
import type { DerbyRunRecord } from './homeRunDerby.js'
import {
  entryChanges,
  type EntryChanges,
  type GameRun,
  type LeaderboardEntry,
  type RankedRecord,
  type RunCursor,
} from './leaderboard.js'
import { profileIdOf } from './leaderboardIdentity.js'
import { boundedInteger, invalidInput, matchingText, oneOf } from './validation.js'

// The admin's side of the weekly boards. Nothing waits for the admin: a result, a name, and a signed-in link all show
// at once. So this is a plain list of who played, newest first, with what the server found unusual about each run as
// marks, and what the admin does afterwards: remove a record or put it back, take a name, a character, or a link off,
// and close the reports visitors send. Every action names the version the admin read.

/** Reports one visitor may send in an hour; more are dropped without a word. */
export const reportsPerHour = 5
/** How often the report counter forgets the visitors with no report in the last hour (`forgetQuietReporters`). */
export const reportSweepIntervalMs = 60_000
const hourMs = 60 * 60_000
const versionPattern = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u
const idPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u
/** How many runs a page of the list holds unless the request asks for fewer or more. */
export const playsPageSize = 50
export const playsPageLimit = 100
/** How many reported records the list's first page names: a flood of reports must not swell it. */
export const reportedRecordsLimit = 100
/** How much of a visitor hash the list shows, to tell one visitor's rows from another's. */
const visitorKeyLength = 12

export const reportTargets = ['name', 'character', 'link'] as const
export type ReportTarget = (typeof reportTargets)[number]
/** `mine` is a profile's owner saying they did not link it, so it is only for a link. */
export const reportReasons = ['mine', 'other'] as const
export type ReportReason = (typeof reportReasons)[number]
/** `kept` leaves the reported thing on the record, showing; `removed` takes it off. */
export const reportResolutions = ['kept', 'removed'] as const
export type ReportResolution = (typeof reportResolutions)[number]

/** A report keeps no reporter: neither the visitor hash nor the address. */
export interface EntryReport {
  id: string
  entryId: string
  target: ReportTarget
  reason: ReportReason
  createdAt: string
  resolvedAt: string | null
  resolution: ReportResolution | null
}

/** A record as the admin's list holds it: with its place and its open reports. */
export interface ReviewedRecord extends RankedRecord {
  reports: EntryReport[]
}

/** One page of a board's runs, newest first, with the records of the visitors on it. */
export interface PlaysPage {
  season: string
  runs: GameRun[]
  records: ReviewedRecord[]
  /** The board's records with open reports, on the first page only: a report must not wait on a page nobody opens. */
  reported: ReviewedRecord[]
  /** Where the next page starts, or `null` on the last. */
  nextCursor: string | null
}

/** The admin's version of a record, as they read it; nothing else is accepted, so a stale tab gets `409`. */
export function versionInput(value: unknown, field: string): string {
  return matchingText(value, versionPattern, field, "the record's updatedAt as it was read")
}

/** The run a page ended with, as the next page's `cursor`. */
export function runCursorText(run: GameRun): string {
  return `${run.issuedAt}_${run.id}`
}

/** A `cursor` as `runCursorText` wrote it; `null` starts from the newest run. */
export function parseRunCursor(value: string | null): RunCursor | null {
  if (value === null) return null
  const [issuedAt, id] = value.split('_')
  return {
    issuedAt: matchingText(issuedAt, versionPattern, 'cursor', 'the nextCursor of the page before'),
    id: matchingText(id, idPattern, 'cursor', 'the nextCursor of the page before'),
  }
}

export function parsePageLimit(value: string | null): number {
  if (value === null) return playsPageSize
  if (!/^[0-9]{1,3}$/u.test(value)) throw invalidInput(`limit must be a whole number from 1 to ${playsPageLimit}`)
  return boundedInteger(Number(value), 'limit', 1, playsPageLimit)
}

/** Enough of a visitor hash to group one visitor's rows; the cookie it came from cannot be worked back from it. */
export function visitorKey(visitorHash: string): string {
  return visitorHash.slice(0, visitorKeyLength)
}

/** The list as the admin reads it. A run says whether it is its visitor's record (`best`). */
export function playsView(page: PlaysPage) {
  const bestRunIds = new Set(page.records.map(({ entry }) => entry.bestRunId))
  return {
    season: page.season,
    runs: page.runs.map((run) => reviewedRun(run, bestRunIds.has(run.id))),
    records: page.records.map(reviewedRecord),
    reported: page.reported.map(reviewedRecord),
    nextCursor: page.nextCursor,
  }
}

export function reviewedRecord({ entry, rank, reports }: ReviewedRecord) {
  return reviewedEntry(entry, rank, reports)
}

/** The open reports on a record, one line per target with how many and when the last came. */
export function reportSummary(reports: readonly EntryReport[]) {
  return reportTargets.flatMap((target) => {
    const group = reports.filter((report) => report.target === target)
    const lastReportedAt = group.map((report) => report.createdAt).sort()
    return group.length === 0
      ? []
      : [
          {
            target,
            count: group.length,
            mine: group.some((report) => report.reason === 'mine'),
            lastReportedAt: lastReportedAt.at(-1),
          },
        ]
  })
}

/**
 * A record as the admin reads it: the real name and every state, the version an action names, the place it holds or
 * would hold, and the whole link, decoded, with whether it was percent-encoded, since an encoded id can hide what it
 * reads as, beside the display name of the LinkedIn account that signed in for it.
 */
export function reviewedEntry(entry: LeaderboardEntry, rank: number, reports: readonly EntryReport[]) {
  const linkedIn = entry.linkedIn
  return {
    id: entry.id,
    season: entry.season,
    visitor: visitorKey(entry.visitorHash),
    rank: entry.disqualified ? null : rank,
    updatedAt: entry.updatedAt,
    bestRunId: entry.bestRunId,
    listed: entry.listed,
    name: entry.authorName,
    nameStatus: entry.nameStatus,
    disqualified: entry.disqualified,
    // A record keeps an appearance because the schema needs one, but after a takedown no one reads it, the admin included.
    profile: entry.takedown ? null : entry.appearance,
    appearancePublic: entry.appearancePublic,
    takedown: entry.takedown,
    homeRuns: entry.score,
    totalDistanceDm: entry.tiebreak,
    achievedAt: entry.achievedAt,
    linkedIn: linkedIn && {
      profileUrl: linkedIn.profileUrl,
      profileId: profileIdOf(linkedIn.profileUrl),
      encoded: linkedIn.profileUrl.includes('%'),
      status: linkedIn.status,
      verifiedName: linkedIn.verifiedName,
    },
    reports: reportSummary(reports),
  }
}

/** A run with its marks and what the server worked out per pitch, which visitors never see: timing error and power. */
export function reviewedRun(run: GameRun, best: boolean) {
  return {
    id: run.id,
    season: run.season,
    visitor: visitorKey(run.visitorHash),
    status: run.status,
    flags: run.flags,
    best,
    issuedAt: run.issuedAt,
    submittedAt: run.submittedAt,
    homeRuns: run.score,
    totalDistanceDm: run.tiebreak,
    result: run.result && reviewedResult(run.result, run.inputLog),
  }
}

export function reviewedResult(record: DerbyRunRecord, log: DerbyInputLog | null) {
  const swings = log?.swings ?? []
  return {
    claimed: record.claimed,
    serverElapsedMs: record.serverElapsedMs,
    clientElapsedMs: record.clientElapsedMs,
    calibration: record.calibration,
    practiceMedianMs: record.practiceMedianMs,
    practiceSpeeds: log?.practice.map((sample) => sample.speed) ?? [],
    pitches: record.pitches.map((pitch, index) =>
      reviewedPitch(pitch, swings[index] ?? null, record.calibration.peakSpeed),
    ),
  }
}

export function reviewedPitch(pitch: PitchResult, swing: SwingEvent | null, peakSpeed: number) {
  return {
    pitchType: pitch.pitchType,
    outcome: pitch.outcome,
    distanceDm: pitch.outcome === 'miss' ? null : pitch.distanceDecimetres,
    errorMs: pitch.errorMs,
    power: swing && swingPower(swing.speed, peakSpeed),
    swingDurationMs: swing && swing.contactMs - swing.startedMs,
    heightError: swing?.heightError ?? null,
    swingSpeed: swing?.speed ?? null,
  }
}

/** Off the board at once, so the next record takes its place; the visitor's later runs on the board stay off too. */
export function disqualificationChanges(entry: LeaderboardEntry, _input: unknown, now: string): EntryChanges {
  return entryChanges(entry, { disqualified: true }, now)
}

/** Back on the board at its place, at once. */
export function restorationChanges(entry: LeaderboardEntry, _input: unknown, now: string): EntryChanges {
  if (!entry.disqualified) throw new DomainError('CONFLICT', 'The record is not disqualified')
  return entryChanges(entry, { disqualified: false }, now)
}

export function publicInput(input: Record<string, unknown>): boolean {
  if (typeof input.public !== 'boolean') throw invalidInput('public must be a boolean')
  return input.public
}

/** `false` takes the name off, leaving an anonymous batter; `true` shows it again, a name the check refused too. */
export function nameChanges(entry: LeaderboardEntry, input: Record<string, unknown>, now: string): EntryChanges {
  const shown = publicInput(input)
  if (entry.authorName === null) throw new DomainError('CONFLICT', 'The record has no name')
  return entryChanges(entry, { nameStatus: shown ? 'shown' : 'rejected' }, now)
}

/** The public portrait: `false` shows the default batter, on statues too. */
export function appearanceChanges(entry: LeaderboardEntry, input: Record<string, unknown>, now: string) {
  const shown = publicInput(input)
  if (shown && entry.takedown) throw new DomainError('CONFLICT', 'A record taken down keeps the default batter')
  return entryChanges(entry, { appearancePublic: shown }, now)
}

export function assertBlockInput(input: Record<string, unknown>): void {
  if (input.blockLinkedIn !== undefined && typeof input.blockLinkedIn !== 'boolean') {
    throw invalidInput('blockLinkedIn must be a boolean')
  }
}

/** Deletes the link, whatever its state. `blockLinkedIn` is read afterwards. */
export function linkedInRemovalChanges(entry: LeaderboardEntry, input: Record<string, unknown>, now: string) {
  assertBlockInput(input)
  if (!entry.linkedIn) throw new DomainError('CONFLICT', 'The record has no link')
  return entryChanges(entry, { linkedIn: null }, now)
}

export function parseReportResolution(input: Record<string, unknown>) {
  return {
    target: oneOf(input.target, reportTargets, 'target'),
    resolution: oneOf(input.resolution, reportResolutions, 'resolution'),
  }
}

/** Closing a record's reports on one target decides it: the name, the appearance, or the link. */
export function reportResolutionChanges(entry: LeaderboardEntry, input: Record<string, unknown>, now: string) {
  const { target, resolution } = parseReportResolution(input)
  return entryChanges(entry, resolvedReportChanges[target](entry, resolution === 'kept'), now)
}

export const resolvedReportChanges: Readonly<
  Record<ReportTarget, (entry: LeaderboardEntry, kept: boolean) => Partial<EntryChanges>>
> = {
  name: resolvedNameChanges,
  character: resolvedCharacterChanges,
  link: resolvedLinkChanges,
}

export function resolvedNameChanges(entry: LeaderboardEntry, kept: boolean): Partial<EntryChanges> {
  if (entry.authorName === null) return {}
  return { nameStatus: kept ? 'shown' : 'rejected' }
}

export function resolvedCharacterChanges(entry: LeaderboardEntry, kept: boolean): Partial<EntryChanges> {
  return { appearancePublic: kept && !entry.takedown }
}

/**
 * A removed link is deleted. Keeping one a profile's owner reported (`reported`) is the admin vouching for it, so it
 * shows again as `verified`; any other kept link stays as it is, and an `unverified` one still needs its sign-in.
 */
export function resolvedLinkChanges(entry: LeaderboardEntry, kept: boolean): Partial<EntryChanges> {
  if (!kept) return { linkedIn: null }
  if (entry.linkedIn?.status !== 'reported') return {}
  return { linkedIn: { ...entry.linkedIn, status: 'verified' } }
}

/**
 * A takedown request anonymises the record rather than delete it, so a false request cannot knock a rival off the
 * board: no name, no link, the default batter, and the score keeps its place. `blockLinkedIn` is read afterwards.
 */
export function takedownChanges(entry: LeaderboardEntry, input: Record<string, unknown>, now: string) {
  assertBlockInput(input)
  const anonymous = { authorName: null, nameStatus: null, linkedIn: null, appearancePublic: false, takedown: true }
  return entryChanges(entry, anonymous, now)
}

/** What each admin action on a record changes, from the record as it stands and the request body. */
export const entryReviewChanges = {
  disqualification: disqualificationChanges,
  restoration: restorationChanges,
  name: nameChanges,
  appearance: appearanceChanges,
  'linkedin-removal': linkedInRemovalChanges,
  'report-resolution': reportResolutionChanges,
  takedown: takedownChanges,
} as const satisfies Record<
  string,
  (entry: LeaderboardEntry, input: Record<string, unknown>, now: string) => EntryChanges
>
export type EntryReviewAction = keyof typeof entryReviewChanges

export function parseEntryReport(input: Record<string, unknown>): Pick<EntryReport, 'target' | 'reason'> {
  const target = oneOf(input.target, reportTargets, 'target')
  const reason = oneOf(input.reason ?? 'other', reportReasons, 'reason')
  if (reason === 'mine' && target !== 'link') throw invalidInput("reason 'mine' is only for a link")
  return { target, reason }
}

/** The reports a visitor sent in the last hour, of the times in `times`. */
export function recentReports(times: readonly number[], now: number): number[] {
  return times.filter((time) => now - time < hourMs)
}

/** Drops the visitors with no report in the last hour, since visitor cookies cost nothing to make. */
export function forgetQuietReporters(reportTimes: Map<string, number[]>, now: number): void {
  const quiet = [...reportTimes].filter(([, times]) => recentReports(times, now).length === 0)
  quiet.forEach(([visitorHash]) => reportTimes.delete(visitorHash))
}

/**
 * What a report changes at once: only a link whose profile's owner says it is theirs, which is hidden until the admin
 * decides. Every other report waits for the admin, so no visitor can take a name or a character off the board. `null`
 * when it changes nothing.
 */
export function reportedChanges(
  entry: LeaderboardEntry,
  report: Pick<EntryReport, 'target' | 'reason'>,
  now: string,
): EntryChanges | null {
  const linkedIn = entry.linkedIn
  if (!linkedIn || report.target !== 'link' || report.reason !== 'mine') return null
  return entryChanges(entry, { linkedIn: { ...linkedIn, status: 'reported' } }, now)
}

/**
 * Whether a profile's owner has an open report on the record's link. While one is open the record takes no link, so
 * turning the hidden link off and on, or signing in again, cannot bring it back before the admin decides.
 */
export function hasOpenLinkClaim(openReports: readonly EntryReport[]): boolean {
  return openReports.some((report) => report.target === 'link' && report.reason === 'mine')
}
