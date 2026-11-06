import { requestJson, requireList, requireRecord, requireText, responseRecord } from './apiClient'
import {
  LeaderboardRequestError,
  oneOf,
  wholeNumber,
  type LinkedInStatus,
  type NameStatus,
  type ReportTarget,
} from './leaderboardApi'
import { normalizePlayerProfile, type PlayerProfile } from './playerProfile'

// The wire format of the admin's board review (backend/README.md "Board review"). Everything here is visitor input the
// server has stored: names and links stay plain text in the page. One malformed item never costs the admin the others,
// and the dialog says how many it skipped, since a queue that hides an item silently would hide what needs a decision.

const reviewPath = '/v1/admin/games/home-run-derby'
export const seasonPattern = /^\d{4}-(0[1-9]|1[0-2])$/u

/** Mirrors the server's bound on one dismissal; a bigger flood takes another click. */
export const DISMISSED_RUNS_LIMIT = 1000

/** The queue's kinds, most urgent first, as the server orders them. */
export const REVIEW_KINDS = ['statue', 'statue-run', 'report', 'linkedin', 'past-run', 'run', 'name'] as const
export type ReviewKind = (typeof REVIEW_KINDS)[number]
const reviewStatuses = ['pending', 'approved', 'disqualified'] as const
export type ReviewStatus = (typeof reviewStatuses)[number]
const nameStatuses = ['pending', 'approved', 'rejected'] as const
const linkStatuses = ['pending', 'approved', 'reported'] as const
const reportTargets = ['name', 'character', 'link'] as const
const pitchTypes = ['fastball', 'changeup', 'curve'] as const
const pitchOutcomes = ['homeRun', 'hit', 'foul', 'miss'] as const

export type ReviewedLink = {
  profileUrl: string
  /** The id decoded, which is what the address really reads as. */
  profileId: string
  encoded: boolean
  status: LinkedInStatus
  code: string
}

/** What the admin sees per pitch; a record's copied public result has only the type, outcome, and distance. */
export type ReviewedPitch = {
  pitchType: (typeof pitchTypes)[number]
  outcome: (typeof pitchOutcomes)[number]
  distanceDm: number | null
  errorMs: number | null
  power: number | null
  swingDurationMs: number | null
  heightError: number | null
  swingSpeed: number | null
}

/** A record as the admin reviews it. `updatedAt` is the version every action on it names. */
export type ReviewedEntry = {
  id: string
  season: string
  /** The place it holds, or would take when off the board. */
  rank: number | null
  updatedAt: string
  bestRunId: string | null
  listed: boolean
  name: string | null
  nameStatus: NameStatus | null
  reviewStatus: ReviewStatus
  /** `null` once taken down: the character is hidden from everyone, the admin included. */
  profile: PlayerProfile | null
  appearancePublic: boolean
  takedown: boolean
  homeRuns: number
  totalDistanceDm: number
  achievedAt: string
  pitches: ReviewedPitch[]
  linkedIn: ReviewedLink | null
}

export type ReviewedRunResult = {
  homeRuns: number
  totalDistanceDm: number
  claimed: { homeRuns: number; totalDistanceDm: number }
  serverElapsedMs: number
  clientElapsedMs: number
  calibration: { offsetMs: number; peakSpeed: number }
  practiceMedianMs: number
  practiceSpeeds: number[]
  pitches: ReviewedPitch[]
}

export type ReviewedRun = {
  id: string
  season: string
  flags: string[]
  wouldBeRank: number | null
  issuedAt: string
  submittedAt: string | null
  name: string | null
  profile: PlayerProfile | null
  result: ReviewedRunResult | null
}

export type ReviewReport = { target: ReportTarget; count: number; mine: boolean; lastReportedAt: string }
export type ReviewWarning =
  { kind: 'similar-name'; name: string } | { kind: 'same-appearance'; name: string | null } | { kind: 'town-link' }
export type NeighbourName = { rank: number; name: string | null }
export type VisitorCounts = { runs: number; abandoned: number; flagged: number }

/**
 * One visitor on one board. `kind` and `visitor` are `null` for a record found outside the queue, whose `warnings` are
 * `null` until they are read. `acceptable` says whether its held runs may still be accepted.
 */
export type ReviewItem = {
  kind: ReviewKind | null
  season: string
  acceptable: boolean
  newVisitor: boolean
  visitor: VisitorCounts | null
  entry: ReviewedEntry | null
  runs: ReviewedRun[]
  reports: ReviewReport[]
  warnings: ReviewWarning[] | null
  neighbours: NeighbourName[]
}

/**
 * What the dialog reads: the queue, and for finding one record, a season's records and, for a season the admin picked,
 * its queue. `season` is the month the records belong to, as the server answered.
 */
export type BoardReviewData = {
  queue: ReviewItem[]
  season: string
  records: ReviewedEntry[]
  seasonQueue: ReviewItem[]
  unreadable: number
}

/** An action on a record; its fields beyond `kind` are the request's body, beside the `updatedAt` it read. */
export type RecordAction =
  | { kind: 'approval'; name?: 'approve' | 'reject' }
  | { kind: 'disqualification' }
  | { kind: 'restoration' }
  | { kind: 'linkedin-review'; decision: 'code-verified' | 'reject' }
  | { kind: 'report-resolution'; target: ReportTarget; resolution: 'kept' | 'removed' }
  | { kind: 'appearance'; public: boolean }
  | { kind: 'takedown'; blockLinkedIn?: boolean }

export function finiteNumber(value: unknown, label: string) {
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error(`${label} must be a number`)
  return value
}

export function numberOrNull(value: unknown, label: string) {
  return value === null || value === undefined ? null : finiteNumber(value, label)
}

export function textOrNull(value: unknown, label: string) {
  return value === null || value === undefined ? null : requireText(value, label)
}

/** A time the page can format: formatting an invalid date throws, which would take the whole dialog down. */
export function requireTime(value: unknown, label: string) {
  const time = requireText(value, label)
  if (!Number.isFinite(Date.parse(time))) throw new Error(`${label} must be a time`)
  return time
}

export function requireSeason(value: unknown, label: string) {
  const season = requireText(value, label)
  if (!seasonPattern.test(season)) throw new Error(`${label} must be a season`)
  return season
}

export function parseLink(value: unknown): ReviewedLink | null {
  if (value === null || value === undefined) return null
  const input = requireRecord(value, 'link')
  return {
    profileUrl: requireText(input.profileUrl, 'link.profileUrl'),
    profileId: requireText(input.profileId, 'link.profileId'),
    encoded: input.encoded === true,
    status: oneOf(input.status, linkStatuses, 'link.status'),
    code: requireText(input.code, 'link.code'),
  }
}

/** A pitch of a run, or of a record's public result, whose other fields are then `null`. */
export function parsePitch(value: unknown): ReviewedPitch {
  const input = requireRecord(value, 'pitch')
  return {
    pitchType: oneOf(input.pitchType, pitchTypes, 'pitch.pitchType'),
    outcome: oneOf(input.outcome, pitchOutcomes, 'pitch.outcome'),
    distanceDm: numberOrNull(input.distanceDm, 'pitch.distanceDm'),
    errorMs: numberOrNull(input.errorMs, 'pitch.errorMs'),
    power: numberOrNull(input.power, 'pitch.power'),
    swingDurationMs: numberOrNull(input.swingDurationMs, 'pitch.swingDurationMs'),
    heightError: numberOrNull(input.heightError, 'pitch.heightError'),
    swingSpeed: numberOrNull(input.swingSpeed, 'pitch.swingSpeed'),
  }
}

export function parseReviewedEntry(value: unknown): ReviewedEntry {
  const input = requireRecord(value, 'entry')
  return {
    id: requireText(input.id, 'entry.id'),
    season: requireSeason(input.season, 'entry.season'),
    rank: input.rank === null ? null : wholeNumber(input.rank, 'entry.rank'),
    updatedAt: requireTime(input.updatedAt, 'entry.updatedAt'),
    bestRunId: textOrNull(input.bestRunId, 'entry.bestRunId'),
    listed: input.listed === true,
    name: textOrNull(input.name, 'entry.name'),
    nameStatus: input.nameStatus === null ? null : oneOf(input.nameStatus, nameStatuses, 'entry.nameStatus'),
    reviewStatus: oneOf(input.reviewStatus, reviewStatuses, 'entry.reviewStatus'),
    profile: input.profile === null ? null : normalizePlayerProfile(requireRecord(input.profile, 'entry.profile')),
    appearancePublic: input.appearancePublic === true,
    takedown: input.takedown === true,
    homeRuns: wholeNumber(input.homeRuns, 'entry.homeRuns'),
    totalDistanceDm: wholeNumber(input.totalDistanceDm, 'entry.totalDistanceDm'),
    achievedAt: requireTime(input.achievedAt, 'entry.achievedAt'),
    pitches: requireList(requireRecord(input.result, 'entry.result').pitches, 'entry.result.pitches').map(parsePitch),
    linkedIn: parseLink(input.linkedIn),
  }
}

export function parseRunResult(value: unknown): ReviewedRunResult | null {
  if (value === null || value === undefined) return null
  const input = requireRecord(value, 'run.result')
  const claimed = requireRecord(input.claimed, 'run.result.claimed')
  const calibration = requireRecord(input.calibration, 'run.result.calibration')
  return {
    homeRuns: wholeNumber(input.homeRuns, 'run.result.homeRuns'),
    totalDistanceDm: wholeNumber(input.totalDistanceDm, 'run.result.totalDistanceDm'),
    claimed: {
      homeRuns: wholeNumber(claimed.homeRuns, 'run.result.claimed.homeRuns'),
      totalDistanceDm: wholeNumber(claimed.totalDistanceDm, 'run.result.claimed.totalDistanceDm'),
    },
    serverElapsedMs: finiteNumber(input.serverElapsedMs, 'run.result.serverElapsedMs'),
    clientElapsedMs: finiteNumber(input.clientElapsedMs, 'run.result.clientElapsedMs'),
    calibration: {
      offsetMs: finiteNumber(calibration.offsetMs, 'run.result.calibration.offsetMs'),
      peakSpeed: finiteNumber(calibration.peakSpeed, 'run.result.calibration.peakSpeed'),
    },
    practiceMedianMs: finiteNumber(input.practiceMedianMs, 'run.result.practiceMedianMs'),
    practiceSpeeds: requireList(input.practiceSpeeds, 'run.result.practiceSpeeds').map((speed) =>
      finiteNumber(speed, 'run.result.practiceSpeeds[]'),
    ),
    pitches: requireList(input.pitches, 'run.result.pitches').map(parsePitch),
  }
}

export function parseReviewedRun(value: unknown): ReviewedRun {
  const input = requireRecord(value, 'run')
  return {
    id: requireText(input.id, 'run.id'),
    season: requireSeason(input.season, 'run.season'),
    flags: requireList(input.flags, 'run.flags').map((flag) => requireText(flag, 'run.flags[]')),
    wouldBeRank: input.wouldBeRank === null ? null : wholeNumber(input.wouldBeRank, 'run.wouldBeRank'),
    issuedAt: requireTime(input.issuedAt, 'run.issuedAt'),
    submittedAt: input.submittedAt === null ? null : requireTime(input.submittedAt, 'run.submittedAt'),
    name: textOrNull(input.name, 'run.name'),
    profile: input.profile === null ? null : normalizePlayerProfile(requireRecord(input.profile, 'run.profile')),
    result: parseRunResult(input.result),
  }
}

export function parseReport(value: unknown): ReviewReport {
  const input = requireRecord(value, 'report')
  return {
    target: oneOf(input.target, reportTargets, 'report.target'),
    count: wholeNumber(input.count, 'report.count'),
    mine: input.mine === true,
    lastReportedAt: requireTime(input.lastReportedAt, 'report.lastReportedAt'),
  }
}

export function parseWarning(value: unknown): ReviewWarning {
  const input = requireRecord(value, 'warning')
  if (input.kind === 'town-link') return { kind: 'town-link' }
  if (input.kind === 'similar-name') return { kind: 'similar-name', name: requireText(input.name, 'warning.name') }
  if (input.kind === 'same-appearance') return { kind: 'same-appearance', name: textOrNull(input.name, 'warning.name') }
  throw new Error('warning.kind is unknown')
}

export function parseNeighbour(value: unknown): NeighbourName {
  const input = requireRecord(value, 'neighbour')
  return { rank: wholeNumber(input.rank, 'neighbour.rank'), name: textOrNull(input.name, 'neighbour.name') }
}

/** A queue item; one with neither a record nor a held run has nothing to act on, so it counts as malformed. */
export function parseReviewItem(value: unknown): ReviewItem {
  const input = requireRecord(value, 'item')
  const counts = requireRecord(input.visitor, 'item.visitor')
  const entry = input.entry === null ? null : parseReviewedEntry(input.entry)
  const runs = requireList(input.runs, 'item.runs').map(parseReviewedRun)
  if (entry === null && runs.length === 0) throw new Error('item has no record and no run')
  return {
    kind: oneOf(input.kind, REVIEW_KINDS, 'item.kind'),
    season: requireSeason(input.season, 'item.season'),
    acceptable: input.acceptable === true,
    newVisitor: input.newVisitor === true,
    visitor: {
      runs: wholeNumber(counts.runs, 'item.visitor.runs'),
      abandoned: wholeNumber(counts.abandoned, 'item.visitor.abandoned'),
      flagged: wholeNumber(counts.flagged, 'item.visitor.flagged'),
    },
    entry,
    runs,
    reports: requireList(input.reports, 'item.reports').map(parseReport),
    warnings: requireList(input.warnings, 'item.warnings').map(parseWarning),
    neighbours: requireList(input.neighbours, 'item.neighbours').map(parseNeighbour),
  }
}

export function readableItem<Item>(value: unknown, parse: (value: unknown) => Item): Item[] {
  try {
    return [parse(value)]
  } catch {
    return []
  }
}

/** The items that read, in the server's order, and how many did not. */
export function readableList<Item>(value: unknown, label: string, parse: (value: unknown) => Item) {
  const list = requireList(value, label)
  const items = list.flatMap((item) => readableItem(item, parse))
  return { items, unreadable: list.length - items.length }
}

export async function sendReview(path: string, init: RequestInit, request: typeof fetch) {
  const response = await requestJson(`${reviewPath}${path}`, init, request)
  if (!response.ok) throw new LeaderboardRequestError(response.status)
  return response
}

/** The queue of one season, or of this season and the last. */
export async function fetchReviewQueue(season: string | null, request: typeof fetch = fetch) {
  const query = season ? `?season=${encodeURIComponent(season)}` : ''
  const payload = await responseRecord(await sendReview(`/review${query}`, {}, request))
  return readableList(payload.items, 'items', parseReviewItem)
}

/** Every record on a season's board, whatever its state, in public order. */
export async function fetchBoardRecords(season: string | null, request: typeof fetch = fetch) {
  const query = season ? `?season=${encodeURIComponent(season)}` : ''
  const payload = await responseRecord(await sendReview(`/entries${query}`, {}, request))
  return {
    season: requireSeason(payload.season, 'season'),
    ...readableList(payload.entries, 'entries', parseReviewedEntry),
  }
}

/** The warnings of the records a search found, by id, which only they need: reading them costs the server a board each. */
export async function fetchRecordWarnings(
  season: string | null,
  recordIds: string,
  request: typeof fetch = fetch,
): Promise<Record<string, ReviewWarning[]>> {
  if (recordIds === '') return {}
  const seasonQuery = season ? `&season=${encodeURIComponent(season)}` : ''
  const path = `/entries/warnings?ids=${encodeURIComponent(recordIds)}${seasonQuery}`
  const payload = await responseRecord(await sendReview(path, {}, request))
  const warnings = Object.entries(requireRecord(payload.warnings, 'warnings'))
  return Object.fromEntries(warnings.map(([id, list]) => [id, requireList(list, 'warnings[]').map(parseWarning)]))
}

/**
 * All the dialog reads. A picked `season`'s own queue comes too, since a record found there may have reports or held
 * runs the default queue leaves out: it covers only this season and the last. Until the admin picks one, `season` stays
 * `null` and the server decides what this season is, so a device clock past a month's end cannot fail the whole read.
 */
export async function fetchBoardReview(season: string | null, request: typeof fetch = fetch): Promise<BoardReviewData> {
  const [queue, records, seasonQueue] = await Promise.all([
    fetchReviewQueue(null, request),
    fetchBoardRecords(season, request),
    season === null ? null : fetchReviewQueue(season, request),
  ])
  return {
    queue: queue.items,
    season: records.season,
    records: records.items,
    seasonQueue: seasonQueue?.items ?? [],
    // The reads overlap, so the largest says how many at least; a sum would count one item two or three times.
    unreadable: Math.max(queue.unreadable, records.unreadable, seasonQueue?.unreadable ?? 0),
  }
}

/** A record's best run in full: the queue only brings held runs. */
export async function fetchReviewedRun(runId: string, request: typeof fetch = fetch) {
  const response = await sendReview(`/runs/${encodeURIComponent(runId)}`, {}, request)
  return parseReviewedRun((await responseRecord(response)).run)
}

/** Where an action goes and what it sends, always with the version the admin read. Undoing is `DELETE` of the same path. */
export function recordActionRequest(entry: Pick<ReviewedEntry, 'id' | 'updatedAt'>, action: RecordAction) {
  const { kind, ...details } = action
  const undo = kind === 'restoration'
  return {
    path: `/entries/${encodeURIComponent(entry.id)}/${undo ? 'disqualification' : kind}`,
    init: { method: undo ? 'DELETE' : 'POST', body: JSON.stringify({ updatedAt: entry.updatedAt, ...details }) },
  }
}

export async function sendRecordAction(
  entry: ReviewedEntry,
  action: RecordAction,
  request: typeof fetch = fetch,
): Promise<ReviewedEntry> {
  const { path, init } = recordActionRequest(entry, action)
  return parseReviewedEntry((await responseRecord(await sendReview(path, init, request))).entry)
}

/** Accepts a held run from the visitor's record as the admin read it, or from having none. */
export async function acceptHeldRun(
  run: ReviewedRun,
  entry: ReviewedEntry | null,
  request: typeof fetch = fetch,
): Promise<ReviewedEntry> {
  const body = JSON.stringify({ updatedAt: entry?.updatedAt ?? null })
  const response = await sendReview(`/runs/${encodeURIComponent(run.id)}/acceptance`, { method: 'POST', body }, request)
  return parseReviewedEntry((await responseRecord(response)).entry)
}

export async function dismissHeldRun(run: ReviewedRun, request: typeof fetch = fetch): Promise<void> {
  await sendReview(`/runs/${encodeURIComponent(run.id)}/rejection`, { method: 'POST' }, request)
}

/** Dismisses the listed held runs in one request, and answers how many were still waiting. */
export async function dismissListedRuns(runIds: readonly string[], request: typeof fetch = fetch): Promise<number> {
  const response = await sendReview('/runs/rejection', { method: 'POST', body: JSON.stringify({ runIds }) }, request)
  return wholeNumber((await responseRecord(response)).rejected, 'rejected')
}
