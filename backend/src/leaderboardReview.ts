import { isDeepStrictEqual } from 'node:util'
import type { DerbyInputLog, PitchResult, SwingEvent } from './derbyJudge/derbyScore.js'
import { swingPower } from './derbyJudge/judging.js'
import { DomainError } from './domain.js'
import { publicDerbyResult, type DerbyRunRecord } from './homeRunDerby.js'
import {
  boardOrder,
  entryChanges,
  isPublicEntry,
  statueCount,
  type BoardCandidate,
  type BoardKey,
  type BoardPlace,
  type EntryChanges,
  type GameRun,
  type LeaderboardEntry,
  type SettleEntry,
} from './leaderboard.js'
import { comparisonForm, isTownProfile, profileIdOf, townNames } from './leaderboardIdentity.js'
import { nextRankingMonth, rankingMonthStart, type TownLayout } from './town.js'
import { inputList, invalidInput, matchingText, oneOf } from './validation.js'

// The admin's side of the monthly boards: the review queue, what each action on a record changes, and the reports
// visitors send. A statue stands without anyone's check, so the queue puts what visitors already see first, and every
// action names the version the admin read, so nothing they have not seen is approved.

/** A held run of a season that has ended may still be accepted this long after; then its board stays as it is. */
export const lateAcceptanceMs = 7 * 24 * 60 * 60_000
/** A visitor with this few runs on a board has no history there, which the queue marks. */
export const noHistoryRunCount = 2
/** Reports one visitor may send in an hour; more are dropped without a word. */
export const reportsPerHour = 5
/** How often the report counter forgets the visitors with no report in the last hour (`forgetQuietReporters`). */
export const reportSweepIntervalMs = 60_000
const hourMs = 60 * 60_000
/** Names this many places either side, so names that read as a sentence together are seen together. */
const neighbourDistance = 3
const versionPattern = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u
const idPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u
/** How many held runs one dismissal may name: a flood takes a few clicks, each one request. */
export const dismissedRunsLimit = 1000
const nameDecisions = ['approve', 'reject'] as const
const linkedInDecisions = ['code-verified', 'reject'] as const

export const reportTargets = ['name', 'character', 'link'] as const
export type ReportTarget = (typeof reportTargets)[number]
/** `mine` is a profile's owner saying they did not link it, so it is only for a link. */
export const reportReasons = ['mine', 'other'] as const
export type ReportReason = (typeof reportReasons)[number]
/** `kept` shows the reported thing again; `removed` takes it off the record. */
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

/** How many runs a visitor started for a board, abandoned, and had held. */
export interface VisitorRunCounts {
  visitorHash: string
  runs: number
  abandoned: number
  flagged: number
}

/** The queue's order, most urgent first: what visitors already see, then what would change it, then the rest. */
export const reviewKinds = ['statue', 'statue-run', 'report', 'linkedin', 'past-run', 'run', 'name'] as const
export type ReviewKind = (typeof reviewKinds)[number]

/** What the queue reads of one board. */
export interface ReviewBoard extends BoardKey {
  /** Every record on the board, in public order. */
  entries: LeaderboardEntry[]
  /** Held runs nobody has reviewed. */
  runs: GameRun[]
  reports: EntryReport[]
  counts: VisitorRunCounts[]
}

export interface ReviewContext {
  town: TownLayout | null
  currentSeason: string
  now: number
}

/** One visitor on one board, the queue's unit: their record, their held runs, and the reports on the record. */
export interface ReviewSubject {
  board: ReviewBoard
  /** The board's place in the request; this season's comes first. */
  boardIndex: number
  current: boolean
  /** Whether the board's held runs may still be accepted. */
  acceptable: boolean
  publicEntries: LeaderboardEntry[]
  visitorHash: string
  entry: LeaderboardEntry | null
  /** Best first. */
  runs: GameRun[]
  /** The record's place in the public order, or `null` when it is off the board or there is none. */
  place: number | null
  /** The place the best held run would take, or `null` without one. */
  runPlace: number | null
  openReports: EntryReport[]
  counts: VisitorRunCounts
}

/** Each kind and when a subject is one; a subject is the first kind it is. */
export const reviewChecks: ReadonlyArray<readonly [ReviewKind, (subject: ReviewSubject) => boolean]> = [
  ['statue', standsUnreviewed],
  ['statue-run', wouldStand],
  ['report', isReported],
  ['linkedin', hasLinkToCheck],
  ['past-run', hasLateRun],
  ['run', hasCurrentRun],
  ['name', hasNameToCheck],
]

/** The admin's version of a record, as they read it; nothing else is accepted, so a stale tab gets `409`. */
export function versionInput(value: unknown, field: string): string {
  return matchingText(value, versionPattern, field, "the record's updatedAt as it was read")
}

/** The held runs an admin dismisses together: the ones they saw listed, whatever else has arrived since. */
export function parseRunIds(value: unknown): string[] {
  return inputList(value, 'runIds', dismissedRunsLimit, 1).map((id) =>
    matchingText(id, idPattern, 'runIds', 'a list of run ids'),
  )
}

/** The queue across `boards`, one item per visitor and board, most urgent first. */
export function reviewQueue(boards: readonly ReviewBoard[], context: ReviewContext) {
  return boards
    .flatMap((board, boardIndex) => boardSubjects(board, boardIndex, context))
    .flatMap((subject) => {
      const kind = reviewKindOf(subject)
      return kind === null ? [] : [{ subject, kind }]
    })
    .sort(reviewOrder)
    .map(({ subject, kind }) => reviewItem(subject, kind, context))
}

export function boardSubjects(board: ReviewBoard, boardIndex: number, context: ReviewContext): ReviewSubject[] {
  const publicEntries = board.entries.filter(isPublicEntry)
  const places = new Map(publicEntries.map((entry, index) => [entry.id, index + 1]))
  const entries = new Map(board.entries.map((entry) => [entry.visitorHash, entry]))
  const runs = groupBy(board.runs, (run) => run.visitorHash)
  const reports = groupBy(
    board.reports.filter((report) => report.resolvedAt === null),
    (report) => report.entryId,
  )
  const counts = new Map(board.counts.map((count) => [count.visitorHash, count]))
  const visitors = new Set([...entries.keys(), ...runs.keys()])
  return [...visitors].map((visitorHash) => {
    const entry = entries.get(visitorHash) ?? null
    const heldRuns = (runs.get(visitorHash) ?? []).sort(heldRunOrder)
    const bestRun = heldRuns[0]
    return {
      board,
      boardIndex,
      current: board.season === context.currentSeason,
      acceptable: context.now < acceptanceDeadline(board.season),
      publicEntries,
      visitorHash,
      entry,
      runs: heldRuns,
      place: (entry && places.get(entry.id)) ?? null,
      runPlace: bestRun ? wouldBePlace(publicEntries, runBoardPlace(bestRun), visitorHash) : null,
      openReports: (entry && reports.get(entry.id)) ?? [],
      counts: counts.get(visitorHash) ?? { visitorHash, runs: 0, abandoned: 0, flagged: 0 },
    }
  })
}

export function groupBy<Item>(items: readonly Item[], key: (item: Item) => string): Map<string, Item[]> {
  const groups = new Map<string, Item[]>()
  items.forEach((item) => groups.set(key(item), [...(groups.get(key(item)) ?? []), item]))
  return groups
}

export function reviewKindOf(subject: ReviewSubject): ReviewKind | null {
  return reviewChecks.find(([, holds]) => holds(subject))?.[0] ?? null
}

/** A statue no one has approved, or whose name waits: it already stands, so it comes first. */
export function standsUnreviewed(subject: ReviewSubject): boolean {
  const entry = subject.entry
  return isStatue(subject) && (entry?.reviewStatus === 'pending' || entry?.nameStatus === 'pending')
}

/** A held run of this season that would stand as a statue once accepted. */
export function wouldStand(subject: ReviewSubject): boolean {
  return subject.current && subject.runPlace !== null && subject.runPlace <= statueCount
}

export function isReported(subject: ReviewSubject): boolean {
  return subject.openReports.length > 0
}

/** A statue's link waiting for the admin to see its code; a link below the statues is checked once it stands. */
export function hasLinkToCheck(subject: ReviewSubject): boolean {
  const status = subject.entry?.linkedIn?.status
  return isStatue(subject) && status !== undefined && status !== 'approved'
}

/** A past season's held run that may still be accepted, which could change that season's statues. */
export function hasLateRun(subject: ReviewSubject): boolean {
  return !subject.current && subject.acceptable && subject.runs.length > 0
}

export function hasCurrentRun(subject: ReviewSubject): boolean {
  return subject.current && subject.runs.length > 0
}

export function hasNameToCheck(subject: ReviewSubject): boolean {
  return subject.place !== null && subject.entry?.nameStatus === 'pending'
}

export function isStatue(subject: ReviewSubject): boolean {
  return subject.place !== null && subject.place <= statueCount
}

export function isNewVisitor(counts: VisitorRunCounts): boolean {
  return counts.runs <= noHistoryRunCount
}

/** By kind, this season first, a new visitor's held runs after the others', then the better record first. */
export function reviewOrder(
  left: { subject: ReviewSubject; kind: ReviewKind },
  right: { subject: ReviewSubject; kind: ReviewKind },
): number {
  return (
    reviewKinds.indexOf(left.kind) - reviewKinds.indexOf(right.kind) ||
    left.subject.boardIndex - right.subject.boardIndex ||
    historyRank(left) - historyRank(right) ||
    bestPlace(left.subject) - bestPlace(right.subject)
  )
}

export function historyRank({ subject, kind }: { subject: ReviewSubject; kind: ReviewKind }): number {
  return kind === 'run' && isNewVisitor(subject.counts) ? 1 : 0
}

export function bestPlace(subject: ReviewSubject): number {
  return Math.min(subject.place ?? Number.MAX_SAFE_INTEGER, subject.runPlace ?? Number.MAX_SAFE_INTEGER)
}

/** Most home runs, then distance, then the earlier result. */
export function heldRunOrder(left: GameRun, right: GameRun): number {
  return boardOrder(runBoardPlace(left), runBoardPlace(right))
}

/** Where a run would fall on its board if it were the record. */
export function runBoardPlace(run: GameRun): BoardPlace {
  return { id: run.id, score: run.score ?? 0, tiebreak: run.tiebreak ?? 0, achievedAt: run.submittedAt ?? run.issuedAt }
}

/** The place `place` would take among the public records, the visitor's own record aside. */
export function wouldBePlace(
  publicEntries: readonly LeaderboardEntry[],
  place: BoardPlace,
  visitorHash: string,
): number {
  return publicEntries.filter((entry) => entry.visitorHash !== visitorHash && boardOrder(entry, place) < 0).length + 1
}

/** One queue item: everything the admin needs to decide, for one visitor on one board. */
export function reviewItem(subject: ReviewSubject, kind: ReviewKind, context: ReviewContext) {
  const entry = subject.entry
  const place = entry && (subject.place ?? wouldBePlace(subject.publicEntries, entry, subject.visitorHash))
  return {
    kind,
    season: subject.board.season,
    newVisitor: isNewVisitor(subject.counts),
    visitor: { runs: subject.counts.runs, abandoned: subject.counts.abandoned, flagged: subject.counts.flagged },
    entry: entry && reviewedEntry(entry, place),
    runs: subject.runs.map((run) =>
      reviewedRun(run, wouldBePlace(subject.publicEntries, runBoardPlace(run), subject.visitorHash)),
    ),
    reports: reportSummary(subject.openReports),
    warnings: entry ? overlapWarnings(entry, subject.board.entries, context.town) : [],
    neighbours: neighbourNames(subject.publicEntries, subject.place),
  }
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
 * What the record shares with another record on the board or with the town: a name whose comparison form contains
 * another's, an identical appearance, and a link the town shows, which a record can hold only if the town added it
 * after the record claimed it. Only a warning; the admin decides.
 */
export function overlapWarnings(
  entry: LeaderboardEntry,
  entries: readonly LeaderboardEntry[],
  town: TownLayout | null,
) {
  const others = entries.filter((other) => other.visitorHash !== entry.visitorHash)
  const names = [
    ...others.flatMap((other) => (other.authorName === null ? [] : [other.authorName])),
    ...townNames(town),
  ]
  // A taken-down character is shown to no one, so no warning may say what it matches.
  const shownOthers = others.filter((other) => !other.takedown)
  const characters = entry.takedown
    ? []
    : [
        ...shownOthers.map((other) => ({ name: other.authorName, appearance: other.appearance })),
        ...(town?.residents ?? []).map((resident) => ({ name: resident.name, appearance: resident.appearance })),
      ]
  const townLink = entry.linkedIn !== null && isTownProfile(town, profileIdOf(entry.linkedIn.profileUrl))
  return [
    ...similarNames(entry.authorName, names).map((name) => ({ kind: 'similar-name' as const, name })),
    ...characters
      .filter((character) => isDeepStrictEqual(character.appearance, entry.appearance))
      .map(({ name }) => ({ kind: 'same-appearance' as const, name })),
    ...(townLink ? [{ kind: 'town-link' as const }] : []),
  ]
}

export function similarNames(name: string | null, names: readonly string[]): string[] {
  const form = name === null ? '' : comparisonForm(name)
  if (form === '') return []
  return names.filter((other) => {
    const otherForm = comparisonForm(other)
    return otherForm !== '' && form.includes(otherForm)
  })
}

/** The names up to three places either side of `place` in the public order. */
export function neighbourNames(publicEntries: readonly LeaderboardEntry[], place: number | null) {
  if (place === null) return []
  const start = Math.max(0, place - 1 - neighbourDistance)
  return publicEntries
    .slice(start, place + neighbourDistance)
    .map((entry, index) => ({ rank: start + index + 1, name: entry.authorName }))
    .filter(({ rank }) => rank !== place)
}

/**
 * A record as the admin reviews it: the real name and every status, the version an action names, and the whole link,
 * decoded, with whether it was percent-encoded, since an encoded id can hide what it reads as.
 */
export function reviewedEntry(entry: LeaderboardEntry, rank: number | null) {
  const linkedIn = entry.linkedIn
  return {
    id: entry.id,
    season: entry.season,
    rank,
    updatedAt: entry.updatedAt,
    bestRunId: entry.bestRunId,
    listed: entry.listed,
    name: entry.authorName,
    nameStatus: entry.nameStatus,
    reviewStatus: entry.reviewStatus,
    // A record keeps an appearance because the schema needs one, but after a takedown no one reads it, the admin included.
    profile: entry.takedown ? null : entry.appearance,
    appearancePublic: entry.appearancePublic,
    takedown: entry.takedown,
    homeRuns: entry.score,
    totalDistanceDm: entry.tiebreak,
    achievedAt: entry.achievedAt,
    result: entry.result,
    linkedIn: linkedIn && {
      profileUrl: linkedIn.profileUrl,
      profileId: profileIdOf(linkedIn.profileUrl),
      encoded: linkedIn.profileUrl.includes('%'),
      status: linkedIn.status,
      code: linkedIn.code,
    },
  }
}

/**
 * Every record on a board as the admin reviews it, off the board or not, so one the queue does not list can still be
 * acted on: `entries` in public order, and a record off the board with the place it would take, as `rankOf` gives.
 */
export function reviewedBoard(entries: readonly LeaderboardEntry[]) {
  let publicAhead = 0
  return entries.map((entry) => {
    const record = reviewedEntry(entry, publicAhead + 1)
    publicAhead += Number(isPublicEntry(entry))
    return record
  })
}

/** A held run with what the server worked out per pitch, which visitors never see: timing error and power. */
export function reviewedRun(run: GameRun, wouldBeRank: number | null) {
  return {
    id: run.id,
    season: run.season,
    status: run.status,
    flags: run.flags,
    wouldBeRank,
    issuedAt: run.issuedAt,
    submittedAt: run.submittedAt,
    name: run.profile?.name ?? null,
    profile: run.profile?.appearance ?? null,
    result: run.result && reviewedResult(run.result, run.inputLog),
  }
}

export function reviewedResult(record: DerbyRunRecord, log: DerbyInputLog | null) {
  const swings = log?.swings ?? []
  return {
    homeRuns: record.homeRuns,
    totalDistanceDm: record.homeRunDistanceDecimetres,
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

/** Approving keeps the link as it is: only the link review changes a link, so a hidden one stays hidden. */
export function approvalChanges(entry: LeaderboardEntry, input: Record<string, unknown>, now: string): EntryChanges {
  if (entry.reviewStatus === 'disqualified') {
    throw new DomainError('CONFLICT', 'Undo the disqualification before approving the record')
  }
  const decision = input.name === undefined ? null : oneOf(input.name, nameDecisions, 'name')
  const decided = decision === 'approve' ? 'approved' : 'rejected'
  const nameStatus = entry.authorName === null || decision === null ? entry.nameStatus : decided
  return entryChanges(entry, { reviewStatus: 'approved', nameStatus }, now)
}

/** Off the board, so the next record takes its place; the visitor's later runs on the board stay off too. */
export function disqualificationChanges(entry: LeaderboardEntry, _input: unknown, now: string): EntryChanges {
  return entryChanges(entry, { reviewStatus: 'disqualified' }, now)
}

/** Back on the board, waiting for review again. */
export function restorationChanges(entry: LeaderboardEntry, _input: unknown, now: string): EntryChanges {
  if (entry.reviewStatus !== 'disqualified') throw new DomainError('CONFLICT', 'The record is not disqualified')
  return entryChanges(entry, { reviewStatus: 'pending' }, now)
}

/** `code-verified`: the admin saw the record's current code on the profile. `reject` deletes the link. */
export function linkedInReviewChanges(entry: LeaderboardEntry, input: Record<string, unknown>, now: string) {
  const decision = oneOf(input.decision, linkedInDecisions, 'decision')
  if (!entry.linkedIn) throw new DomainError('CONFLICT', 'The record has no link to review')
  const linkedIn = decision === 'reject' ? null : { ...entry.linkedIn, status: 'approved' as const }
  return entryChanges(entry, { linkedIn }, now)
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
  return { nameStatus: kept ? 'approved' : 'rejected' }
}

export function resolvedCharacterChanges(entry: LeaderboardEntry, kept: boolean): Partial<EntryChanges> {
  return { appearancePublic: kept && !entry.takedown }
}

/** A kept link stays as it is: a link its owner reported comes back only through the link review of a new code. */
export function resolvedLinkChanges(_entry: LeaderboardEntry, kept: boolean): Partial<EntryChanges> {
  return kept ? {} : { linkedIn: null }
}

/** The public portrait: `false` shows the default batter, on statues too. */
export function appearanceChanges(entry: LeaderboardEntry, input: Record<string, unknown>, now: string) {
  if (typeof input.public !== 'boolean') throw invalidInput('public must be a boolean')
  if (input.public && entry.takedown) throw new DomainError('CONFLICT', 'A record taken down keeps the default batter')
  return entryChanges(entry, { appearancePublic: input.public }, now)
}

/**
 * A takedown request anonymises the record rather than delete it, so a false request cannot knock a rival off the
 * board: no name, no link, the default batter, and the score keeps its place. `blockLinkedIn` is read afterwards.
 */
export function takedownChanges(entry: LeaderboardEntry, input: Record<string, unknown>, now: string) {
  if (input.blockLinkedIn !== undefined && typeof input.blockLinkedIn !== 'boolean') {
    throw invalidInput('blockLinkedIn must be a boolean')
  }
  const anonymous = { authorName: null, nameStatus: null, linkedIn: null, appearancePublic: false, takedown: true }
  return entryChanges(entry, anonymous, now)
}

/** What each admin action on a record changes, from the record as it stands and the request body. */
export const entryReviewChanges = {
  approval: approvalChanges,
  disqualification: disqualificationChanges,
  restoration: restorationChanges,
  'linkedin-review': linkedInReviewChanges,
  'report-resolution': reportResolutionChanges,
  appearance: appearanceChanges,
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
 * The report targets an owner's change leaves without the admin's keep: it covered the name or appearance they saw,
 * so a new one, or a record put back on the board, is hidden by the next report again.
 */
export function supersededKeeps(before: LeaderboardEntry, after: LeaderboardEntry): ReportTarget[] {
  const relisted = after.listed && !before.listed
  const changed: Record<ReportTarget, boolean> = {
    name: relisted || after.authorName !== before.authorName,
    character: relisted || !isDeepStrictEqual(after.appearance, before.appearance),
    link: false,
  }
  return reportTargets.filter((target) => changed[target])
}

/**
 * What a report hides at once: an approved name or the appearance, unless the admin kept it after an earlier report,
 * and a link whose profile's owner says it is theirs, which then needs a new code. `null` when it hides nothing.
 */
export function reportedChanges(
  entry: LeaderboardEntry,
  report: Pick<EntryReport, 'target' | 'reason'>,
  kept: boolean,
  freshCode: string,
  now: string,
): EntryChanges | null {
  const hidden = reportEffects[report.target](entry, report.reason, kept, freshCode)
  return hidden && entryChanges(entry, hidden, now)
}

type ReportEffect = (
  entry: LeaderboardEntry,
  reason: ReportReason,
  kept: boolean,
  freshCode: string,
) => Partial<EntryChanges> | null

export const reportEffects: Readonly<Record<ReportTarget, ReportEffect>> = {
  name: hiddenName,
  character: hiddenAppearance,
  link: hiddenLink,
}

export function hiddenName(
  entry: LeaderboardEntry,
  _reason: ReportReason,
  kept: boolean,
): Partial<EntryChanges> | null {
  return entry.nameStatus === 'approved' && !kept ? { nameStatus: 'pending' } : null
}

export function hiddenAppearance(
  entry: LeaderboardEntry,
  _reason: ReportReason,
  kept: boolean,
): Partial<EntryChanges> | null {
  return entry.appearancePublic && !kept ? { appearancePublic: false } : null
}

export function hiddenLink(
  entry: LeaderboardEntry,
  reason: ReportReason,
  _kept: boolean,
  freshCode: string,
): Partial<EntryChanges> | null {
  const linkedIn = entry.linkedIn
  return linkedIn && reason === 'mine' ? { linkedIn: { ...linkedIn, status: 'reported', code: freshCode } } : null
}

/** Until when a held run of `season` may be accepted. */
export function acceptanceDeadline(season: string): number {
  return rankingMonthStart(nextRankingMonth(season)) + lateAcceptanceMs
}

/**
 * Whether a past season's record still takes its visitor's listing like this month's: its best run, issued in the
 * season, arrived or was accepted only after the season ended, so the visitor never had the chance. Only until the
 * season's held runs can no longer be accepted; then that board is final.
 */
export function listableAfterSeason(bestRun: GameRun | null, now: number): boolean {
  const settledAt = bestRun?.reviewedAt ?? bestRun?.submittedAt
  if (!bestRun || !settledAt || now >= acceptanceDeadline(bestRun.season)) return false
  return Date.parse(settledAt) >= rankingMonthStart(nextRankingMonth(bestRun.season))
}

export function previousRankingMonth(month: string): string {
  // Date.UTC counts months from 0, so two back from the 1-based number is the month before.
  return new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)) - 2, 1)).toISOString().slice(0, 7)
}

/**
 * A held run as a candidate for its visitor's record; the admin has seen it, so a record it makes is approved. A record
 * taken down has taken its runs' profiles with it, so such a run keeps the record's own hidden look and no name.
 */
export function heldRunCandidate(
  run: GameRun,
  entryId: string,
  record: LeaderboardEntry | null,
): Omit<BoardCandidate, 'nameStatus'> {
  const profile = run.profile ?? (record?.takedown ? { name: null, appearance: record.appearance } : null)
  if (!run.result || !profile || !run.submittedAt) throw new DomainError('CONFLICT', 'This run kept no result')
  return {
    entryId,
    runId: run.id,
    score: run.result.homeRuns,
    tiebreak: run.result.homeRunDistanceDecimetres,
    result: publicDerbyResult(run.result),
    achievedAt: run.submittedAt,
    profile,
    reviewStatus: 'approved',
  }
}

/** Settles only from the record the admin read (`null` when there was none), so an acceptance never lands unseen. */
export function fromVersion(settle: SettleEntry, expectedUpdatedAt: string | null): SettleEntry {
  return (current, latest) => {
    if ((current?.updatedAt ?? null) !== expectedUpdatedAt) {
      throw new DomainError('CONFLICT', "The visitor's record changed after it was loaded")
    }
    return settle(current, latest)
  }
}
