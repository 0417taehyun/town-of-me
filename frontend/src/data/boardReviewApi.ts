import { requestJson, requireList, requireRecord, requireText, responseRecord } from './apiClient'
import { isRankingWeek } from './ballparkRules'
import {
  LeaderboardRequestError,
  LINKED_IN_STATUSES,
  type LinkedInStatus,
  NAME_STATUSES,
  type NameStatus,
  oneOf,
  type ReportTarget,
  wholeNumber,
} from './leaderboardApi'
import { normalizePlayerProfile, type PlayerProfile } from './playerProfile'

// The wire format of the admin's list of who played (backend/README.md "Board review"). Nothing waits for the admin:
// the list shows a week's runs, newest first, with their visitors' records, and the admin takes something off
// afterwards. Everything here is visitor input the server has stored: names and links stay plain text in the page. One
// malformed row never costs the admin the others, and the dialog says how many it skipped.

const reviewPath = '/v1/admin/games/home-run-derby'

/**
 * How far a run got: started with no result yet, abandoned for a newer one, scored, or rejected as too fast. `flagged`
 * is a run the old review held before results stood at once: it never counted, and nothing gets that status now.
 */
export const RUN_STATUSES = ['issued', 'abandoned', 'scored', 'rejected', 'flagged'] as const
export type RunStatus = (typeof RUN_STATUSES)[number]
const reportTargets = ['name', 'character', 'link'] as const
const pitchTypes = ['fastball', 'changeup', 'curve'] as const
const pitchOutcomes = ['homeRun', 'hit', 'foul', 'miss'] as const

export type PlayedLink = {
  profileUrl: string
  /** The id decoded, which is what the address really reads as. */
  profileId: string
  encoded: boolean
  status: LinkedInStatus
  /**
   * The display name of the LinkedIn account that signed in for the link, `null` before anyone has. Sign-in proves an
   * account, not that the address is its own, so the admin compares the two.
   */
  verifiedName: string | null
}

/** What the admin sees per pitch, with the numbers visitors never see. */
export type PlayedPitch = {
  pitchType: (typeof pitchTypes)[number]
  outcome: (typeof pitchOutcomes)[number]
  distanceDm: number | null
  errorMs: number | null
  power: number | null
  swingDurationMs: number | null
  heightError: number | null
  swingSpeed: number | null
}

export type PlayReport = { target: ReportTarget; count: number; mine: boolean; lastReportedAt: string }

/** A visitor's record on a board as the admin reads it. `updatedAt` is the version every action on it names. */
export type PlayedRecord = {
  id: string
  season: string
  /** Joins the record to its visitor's runs. */
  visitor: string
  /** The place it holds, or would take when not posted; `null` once removed from the board. */
  rank: number | null
  updatedAt: string
  bestRunId: string | null
  listed: boolean
  name: string | null
  nameStatus: NameStatus | null
  disqualified: boolean
  /** `null` once taken down: the character is hidden from everyone, the admin included. */
  profile: PlayerProfile | null
  appearancePublic: boolean
  takedown: boolean
  homeRuns: number
  totalDistanceDm: number
  achievedAt: string
  linkedIn: PlayedLink | null
  /** Its open reports, one line per target. */
  reports: PlayReport[]
}

export type PlayedRunResult = {
  claimed: { homeRuns: number; totalDistanceDm: number }
  serverElapsedMs: number
  clientElapsedMs: number
  calibration: { offsetMs: number; peakSpeed: number }
  practiceMedianMs: number
  practiceSpeeds: number[]
  pitches: PlayedPitch[]
}

export type PlayedRun = {
  id: string
  season: string
  visitor: string
  status: RunStatus
  /** The server's marks on it, which block nothing; `too-fast` on a rejected run. */
  flags: string[]
  /** Whether it is its visitor's record. */
  best: boolean
  issuedAt: string
  submittedAt: string | null
  homeRuns: number | null
  totalDistanceDm: number | null
  result: PlayedRunResult | null
}

/**
 * One page of a week's runs, newest first, with the records of the visitors on it. `reported` (records with open
 * reports) comes with the first page only. `nextCursor` goes back as it came for the next page, `null` on the last.
 */
export type PlaysPage = {
  season: string
  runs: PlayedRun[]
  records: PlayedRecord[]
  reported: PlayedRecord[]
  nextCursor: string | null
  unreadable: number
}

/** An action on a record; its fields beyond `kind` are the request's body, beside the `updatedAt` it read. */
export type RecordAction =
  | { kind: 'disqualification' }
  | { kind: 'restoration' }
  | { kind: 'name'; public: boolean }
  | { kind: 'appearance'; public: boolean }
  | { kind: 'linkedin-removal'; blockLinkedIn?: boolean }
  | { kind: 'report-resolution'; target: ReportTarget; resolution: 'kept' | 'removed' }
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
  if (!isRankingWeek(season)) throw new Error(`${label} must be a season`)
  return season
}

export function parseLink(value: unknown): PlayedLink | null {
  if (value === null || value === undefined) return null
  const input = requireRecord(value, 'link')
  return {
    profileUrl: requireText(input.profileUrl, 'link.profileUrl'),
    profileId: requireText(input.profileId, 'link.profileId'),
    encoded: input.encoded === true,
    status: oneOf(input.status, LINKED_IN_STATUSES, 'link.status'),
    verifiedName: textOrNull(input.verifiedName, 'link.verifiedName'),
  }
}

export function parsePitch(value: unknown): PlayedPitch {
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

export function parseReport(value: unknown): PlayReport {
  const input = requireRecord(value, 'report')
  return {
    target: oneOf(input.target, reportTargets, 'report.target'),
    count: wholeNumber(input.count, 'report.count'),
    mine: input.mine === true,
    lastReportedAt: requireTime(input.lastReportedAt, 'report.lastReportedAt'),
  }
}

export function parsePlayedRecord(value: unknown): PlayedRecord {
  const input = requireRecord(value, 'entry')
  return {
    id: requireText(input.id, 'entry.id'),
    season: requireSeason(input.season, 'entry.season'),
    visitor: requireText(input.visitor, 'entry.visitor'),
    rank: input.rank === null ? null : wholeNumber(input.rank, 'entry.rank'),
    updatedAt: requireTime(input.updatedAt, 'entry.updatedAt'),
    bestRunId: textOrNull(input.bestRunId, 'entry.bestRunId'),
    listed: input.listed === true,
    name: textOrNull(input.name, 'entry.name'),
    nameStatus: input.nameStatus === null ? null : oneOf(input.nameStatus, NAME_STATUSES, 'entry.nameStatus'),
    disqualified: input.disqualified === true,
    profile: input.profile === null ? null : normalizePlayerProfile(requireRecord(input.profile, 'entry.profile')),
    appearancePublic: input.appearancePublic === true,
    takedown: input.takedown === true,
    homeRuns: wholeNumber(input.homeRuns, 'entry.homeRuns'),
    totalDistanceDm: wholeNumber(input.totalDistanceDm, 'entry.totalDistanceDm'),
    achievedAt: requireTime(input.achievedAt, 'entry.achievedAt'),
    linkedIn: parseLink(input.linkedIn),
    reports: requireList(input.reports, 'entry.reports').map(parseReport),
  }
}

export function parseRunResult(value: unknown): PlayedRunResult | null {
  if (value === null || value === undefined) return null
  const input = requireRecord(value, 'run.result')
  const claimed = requireRecord(input.claimed, 'run.result.claimed')
  const calibration = requireRecord(input.calibration, 'run.result.calibration')
  return {
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

export function parsePlayedRun(value: unknown): PlayedRun {
  const input = requireRecord(value, 'run')
  return {
    id: requireText(input.id, 'run.id'),
    season: requireSeason(input.season, 'run.season'),
    visitor: requireText(input.visitor, 'run.visitor'),
    status: oneOf(input.status, RUN_STATUSES, 'run.status'),
    flags: requireList(input.flags, 'run.flags').map((flag) => requireText(flag, 'run.flags[]')),
    best: input.best === true,
    issuedAt: requireTime(input.issuedAt, 'run.issuedAt'),
    submittedAt: input.submittedAt === null ? null : requireTime(input.submittedAt, 'run.submittedAt'),
    homeRuns: numberOrNull(input.homeRuns, 'run.homeRuns'),
    totalDistanceDm: numberOrNull(input.totalDistanceDm, 'run.totalDistanceDm'),
    result: parseRunResult(input.result),
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

/** The page's address: no `season` is the server's own week, and no `cursor` the newest runs. */
export function playsQuery(season: string | null, cursor: string | null) {
  const query = new URLSearchParams()
  if (season) query.set('season', season)
  if (cursor) query.set('cursor', cursor)
  const text = query.toString()
  return text ? `?${text}` : ''
}

/**
 * A page of a week's runs with their visitors' records. Until the admin picks a week, `season` stays `null` and the
 * server decides what this week is, so a device clock past a week's end cannot fail the read.
 */
export async function fetchPlays(
  season: string | null,
  cursor: string | null,
  request: typeof fetch = fetch,
): Promise<PlaysPage> {
  const payload = await responseRecord(await sendReview(`/plays${playsQuery(season, cursor)}`, {}, request))
  const runs = readableList(payload.runs, 'runs', parsePlayedRun)
  const records = readableList(payload.records, 'records', parsePlayedRecord)
  const reported = readableList(payload.reported, 'reported', parsePlayedRecord)
  return {
    season: requireSeason(payload.season, 'season'),
    runs: runs.items,
    records: records.items,
    reported: reported.items,
    nextCursor: textOrNull(payload.nextCursor, 'nextCursor'),
    unreadable: runs.unreadable + records.unreadable + reported.unreadable,
  }
}

/** Where an action goes and what it sends, always with the version the admin read. Restoring is `DELETE` of the removal. */
export function recordActionRequest(record: Pick<PlayedRecord, 'id' | 'updatedAt'>, action: RecordAction) {
  const { kind, ...details } = action
  const undo = kind === 'restoration'
  return {
    path: `/entries/${encodeURIComponent(record.id)}/${undo ? 'disqualification' : kind}`,
    init: { method: undo ? 'DELETE' : 'POST', body: JSON.stringify({ updatedAt: record.updatedAt, ...details }) },
  }
}

export async function sendRecordAction(
  record: PlayedRecord,
  action: RecordAction,
  request: typeof fetch = fetch,
): Promise<PlayedRecord> {
  const { path, init } = recordActionRequest(record, action)
  return parsePlayedRecord((await responseRecord(await sendReview(path, init, request))).entry)
}
