import type { DerbyInputLog, DerbyResult } from '../baseball/game/derbyScore'
import { requestJson, requireRecord, requireText, responseRecord } from './apiClient'
import { BASEBALL_DIFFICULTIES, type BallparkRules } from './models'
import { profileAppearance, type PlayerProfile } from './playerProfile'
import { isPitchCount } from './townApi'

// The wire format of the home run derby's monthly board (backend/README.md "Ranked runs"). The client sends no score
// the server keeps: a run's result is its input log, the totals the client worked out (which only decide whether the
// server holds the run for review), and who played it, the character's look and the board name when there is one.
// The run's id in the path and the visitor cookie are the session; the cookie is HttpOnly, so this page never sees it.

const boardPath = '/v1/games/home-run-derby'
/** Mirrors the server's bound on a run's own clock (ms). */
const longestClientRunMs = 600_000
/** Mirrors the server's one-line board name of 1–24 characters, measured after NFKC. */
const boardNameLength = 24

export class LeaderboardRequestError extends Error {
  constructor(readonly status: number) {
    super(`Leaderboard API returned ${status}`)
    this.name = 'LeaderboardRequestError'
  }
}

/** A ranked run the server started: its pitches are planned from these rules and seed, and it is open until `expiresAt`. */
export type IssuedRun = { id: string; expiresAt: number; rules: BallparkRules; seed: number }

/** Where a run left the visitor's record on this month's board, as the server worked it out. */
export type RunStanding =
  | { kind: 'reviewing' }
  | { kind: 'excluded' }
  | { kind: 'ranked'; rank: number; personalBest: boolean }
  | { kind: 'unlisted' | 'consentNeeded'; wouldBeRank: number; personalBest: boolean }

const nameStatuses = ['pending', 'approved', 'rejected'] as const
const linkedInStatuses = ['pending', 'approved', 'reported'] as const
export type NameStatus = (typeof nameStatuses)[number]
export type LinkedInStatus = (typeof linkedInStatuses)[number]

/**
 * The visitor's own record on this month's board. Its LinkedIn link shows only as a hint, since the next person on a
 * shared computer sees this too; `code` is what the visitor puts on the profile for the admin to see.
 */
export type OwnBoardEntry = {
  listed: boolean
  name: string | null
  nameStatus: NameStatus | null
  takedown: boolean
  linkedIn: { profileHint: string; status: LinkedInStatus; code: string } | null
  homeRuns: number
  totalDistanceDm: number
  /** The place it holds, or would hold if listed; `null` while disqualified. */
  rank: number | null
}

/** The server's answer to a run's result: the visitor's standing and their record on the run's board. */
export type RunOutcome = { standing: RunStanding; entry: OwnBoardEntry | null }

/**
 * What the visitor asks of this month's record: off the board, or on it with this character, this name (`null` for an
 * anonymous batter), and their LinkedIn link turned on (an address), off (`null`), or left as it is (`undefined`).
 */
export type ListingChoice =
  { listed: false } | { listed: true; profile: PlayerProfile; name: string | null; linkedIn: string | null | undefined }

export function wholeNumber(value: unknown, label: string) {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${label} must be a whole number`)
  }
  return value
}

/** The rules are checked exactly rather than defaulted: a run played under other rules than issued scores apart. */
export function parseIssuedRun(value: unknown): IssuedRun {
  const input = requireRecord(value, 'run')
  const rules = requireRecord(input.rules, 'run.rules')
  if (!isPitchCount(rules.pitchCount)) throw new Error('run.rules.pitchCount is out of range')
  const seed = wholeNumber(input.seed, 'run.seed')
  const expiresAt = Date.parse(requireText(input.expiresAt, 'run.expiresAt'))
  if (seed >= 2 ** 32 || !Number.isFinite(expiresAt)) throw new Error('run.seed or run.expiresAt is malformed')
  return {
    id: requireText(input.id, 'run.id'),
    expiresAt,
    rules: {
      pitchCount: rules.pitchCount,
      difficulty: oneOf(rules.difficulty, BASEBALL_DIFFICULTIES, 'run.rules.difficulty'),
    },
    seed,
  }
}

export function parseStanding(value: unknown): RunStanding {
  const input = requireRecord(value, 'standing')
  const { kind } = input
  if (kind === 'reviewing' || kind === 'excluded') return { kind }
  const personalBest = input.personalBest === true
  if (kind === 'ranked') return { kind, rank: wholeNumber(input.rank, 'standing.rank'), personalBest }
  if (kind !== 'unlisted' && kind !== 'consentNeeded') throw new Error('standing.kind is unknown')
  return { kind, wouldBeRank: wholeNumber(input.wouldBeRank, 'standing.wouldBeRank'), personalBest }
}

export function oneOf<Value extends string>(value: unknown, values: readonly Value[], label: string): Value {
  if (!(values as readonly unknown[]).includes(value)) throw new Error(`${label} is unknown`)
  return value as Value
}

export function parseOwnLinkedIn(value: unknown): OwnBoardEntry['linkedIn'] {
  if (value === null || value === undefined) return null
  const input = requireRecord(value, 'entry.linkedIn')
  return {
    profileHint: requireText(input.profileHint, 'entry.linkedIn.profileHint'),
    status: oneOf(input.status, linkedInStatuses, 'entry.linkedIn.status'),
    code: requireText(input.code, 'entry.linkedIn.code'),
  }
}

export function parseOwnEntry(value: unknown): OwnBoardEntry {
  const input = requireRecord(value, 'entry')
  const named = typeof input.name === 'string' && input.name !== ''
  return {
    listed: input.listed === true,
    name: named ? (input.name as string) : null,
    nameStatus: named ? oneOf(input.nameStatus, nameStatuses, 'entry.nameStatus') : null,
    takedown: input.takedown === true,
    linkedIn: parseOwnLinkedIn(input.linkedIn),
    homeRuns: wholeNumber(input.homeRuns, 'entry.homeRuns'),
    totalDistanceDm: wholeNumber(input.totalDistanceDm, 'entry.totalDistanceDm'),
    rank: input.rank === null ? null : wholeNumber(input.rank, 'entry.rank'),
  }
}

/**
 * The name as the board keeps it (NFKC, one line, spaces collapsed), or `null` when the board would refuse its format,
 * so a name the board cannot take never costs the run its result.
 */
export function boardName(name: string): string | null {
  const normalized = name.normalize('NFKC')
  if (/\p{Cc}/u.test(normalized)) return null
  const text = normalized.trim().replace(/\s+/gu, ' ')
  const length = Array.from(text).length
  return length >= 1 && length <= boardNameLength ? text : null
}

/** Who played, as the board may show them: the character's look and the board name, never gender or a link. */
export function boardProfile(profile: PlayerProfile, name: string | null) {
  const shownName = name === null ? null : boardName(name)
  const appearance = profileAppearance(profile)
  return shownName === null ? appearance : { name: shownName, ...appearance }
}

/**
 * A ranked run's result: the batting side, the practice numbers and four numbers per pitch, copied field by field and
 * unrounded as the replay used them, so nothing else a log entry might carry (pose keypoints, a trace) is ever sent;
 * the run's own clock; the totals the client scored; and who played (boardProfile).
 */
export function rankedRunBody(
  log: DerbyInputLog,
  result: Pick<DerbyResult, 'homeRuns' | 'homeRunDistanceDecimetres'>,
  clientElapsedMs: number,
  profile: PlayerProfile,
  name: string | null,
) {
  return {
    side: log.side,
    practice: log.practice.map(({ errorMs, speed }) => ({ errorMs, speed })),
    swings: log.swings.map(
      (swing) =>
        swing && {
          contactMs: swing.contactMs,
          startedMs: swing.startedMs,
          speed: swing.speed,
          heightError: swing.heightError,
        },
    ),
    clientElapsedMs: Math.min(longestClientRunMs, Math.max(0, clientElapsedMs)),
    claimed: { homeRuns: result.homeRuns, totalDistanceDm: result.homeRunDistanceDecimetres },
    profile: boardProfile(profile, name),
  }
}

export type RankedRunBody = ReturnType<typeof rankedRunBody>

/** A listing sends the character and name only while it is on; a link only when the visitor turned it on or off. */
export function listingBody(choice: ListingChoice) {
  if (!choice.listed) return { listed: false }
  const linkedIn = choice.linkedIn ? { profileUrl: choice.linkedIn, ownProfile: true } : choice.linkedIn
  return { listed: true, profile: boardProfile(choice.profile, choice.name), linkedIn }
}

export async function sendToBoard(path: string, init: RequestInit, request: typeof fetch) {
  const response = await requestJson(`${boardPath}${path}`, init, request)
  if (!response.ok) throw new LeaderboardRequestError(response.status)
  return response
}

/** Starts a ranked run, which abandons any run this browser left open; the first gets the browser a visitor cookie. */
export async function issueRankedRun(signal?: AbortSignal, request: typeof fetch = fetch): Promise<IssuedRun> {
  const response = await sendToBoard('/runs', { method: 'POST', signal }, request)
  return parseIssuedRun((await responseRecord(response)).run)
}

/** Records a run's result once; sending it again gets the same answer. */
export async function submitRankedRun(
  runId: string,
  body: RankedRunBody,
  request: typeof fetch = fetch,
): Promise<RunOutcome> {
  const path = `/runs/${encodeURIComponent(runId)}/result`
  const payload = await responseRecord(await sendToBoard(path, { method: 'POST', body: JSON.stringify(body) }, request))
  return { standing: parseStanding(payload.standing), entry: payload.entry ? parseOwnEntry(payload.entry) : null }
}

/** Lists or unlists this month's record, or changes the name or link it shows. */
export async function updateOwnRecord(choice: ListingChoice, request: typeof fetch = fetch): Promise<OwnBoardEntry> {
  const init = { method: 'PUT', body: JSON.stringify(listingBody(choice)) }
  return parseOwnEntry((await responseRecord(await sendToBoard('/entries/own', init, request))).entry)
}

/** Deletes every run and record of this browser, in every season. */
export async function deleteOwnRecords(request: typeof fetch = fetch): Promise<void> {
  await sendToBoard('/entries/own', { method: 'DELETE' }, request)
}
