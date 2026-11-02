import type { DerbyInputLog, DerbyResult } from '../baseball/game/derbyScore'
import { requestJson, requireRecord, requireText, responseRecord } from './apiClient'
import { normalizeLinkedInProfileUrl } from './linkedInProfile'
import { BASEBALL_DIFFICULTIES, type BallparkRules } from './models'
import { normalizePlayerProfile, profileAppearance, type PlayerProfile } from './playerProfile'
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

/** The visitor's own record as a season's board shows it, with the character it was posted with. */
export type BoardOwnEntry = OwnBoardEntry & { profile: PlayerProfile }

const nameStates = ['approved', 'reviewing', 'anonymous'] as const
/** How anyone reads a record's name: shown once the admin approved it, still under review, or an anonymous batter. */
export type NameState = (typeof nameStates)[number]

/**
 * A public record on a season's board. `name` is there only once approved; `profile` is `null` for the default batter
 * an anonymous record shows; `linkedInProfileUrl` is a statue's link the admin approved, and never on a list row.
 */
export type BoardRow = {
  id: string
  rank: number
  name: string | null
  nameState: NameState
  profile: PlayerProfile | null
  homeRuns: number
  totalDistanceDm: number
  /** The KST day the record was set. */
  achievedOn: string
  linkedInProfileUrl: string | null
}

/** A KST month's board: its bounds, and whether it is over, so its order is final. */
export type BoardSeason = { id: string; startsAt: number; endsAt: number; final: boolean }

/** A season's statues (places 1–3), its list (4–50), and the visitor's own record on it. */
export type Board = { season: BoardSeason; podium: BoardRow[]; ranks: BoardRow[]; own: BoardOwnEntry | null }

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

/** The places a statue stands for, and the places the list below them shows. */
export const STATUE_PLACES = { first: 1, last: 3 }
export const LIST_PLACES = { first: 4, last: 50 }

/**
 * One public row, read the way the town reads a guestbook entry: the look goes through `normalizePlayerProfile`, and a
 * statue's link through `normalizeLinkedInProfileUrl` again, so nothing but a plain LinkedIn profile becomes a link.
 */
export function parseBoardRow(value: unknown, onStatue: boolean): BoardRow {
  const input = requireRecord(value, 'row')
  const nameState = oneOf(input.nameState, nameStates, 'row.nameState')
  const look = requireRecord(input.profile, 'row.profile')
  const rank = wholeNumber(input.rank, 'row.rank')
  if (rank < 1) throw new Error('row.rank must be a place')
  return {
    id: requireText(input.id, 'row.id'),
    rank,
    name: nameState === 'approved' ? requireText(input.name, 'row.name') : null,
    nameState,
    profile: look.kind === 'default' ? null : normalizePlayerProfile(look),
    homeRuns: wholeNumber(input.homeRuns, 'row.homeRuns'),
    totalDistanceDm: wholeNumber(input.totalDistanceDm, 'row.totalDistanceDm'),
    achievedOn: requireText(input.achievedOn, 'row.achievedOn'),
    linkedInProfileUrl: onStatue ? normalizeLinkedInProfileUrl(input.linkedInProfileUrl) : null,
  }
}

/** A row the page can show, or none: one malformed row never costs the visitor the rest of the board. */
export function readableRow(value: unknown, onStatue: boolean): BoardRow[] {
  try {
    return [parseBoardRow(value, onStatue)]
  } catch {
    return []
  }
}

/**
 * The rows within `places`, in the server's order: the rank it gave, which already breaks a tie in home runs and
 * distance for the earlier record. The page never ranks rows again from their numbers.
 */
export function boardRows(value: unknown, places: typeof STATUE_PLACES, onStatue: boolean): BoardRow[] {
  const rows = (Array.isArray(value) ? value : []).flatMap((row) => readableRow(row, onStatue))
  return rows
    .filter((row) => row.rank >= places.first && row.rank <= places.last)
    .sort((left, right) => left.rank - right.rank)
}

export function parseBoardSeason(value: unknown): BoardSeason {
  const input = requireRecord(value, 'season')
  const id = requireText(input.id, 'season.id')
  const startsAt = Date.parse(requireText(input.startsAt, 'season.startsAt'))
  const endsAt = Date.parse(requireText(input.endsAt, 'season.endsAt'))
  if (!/^\d{4}-(0[1-9]|1[0-2])$/u.test(id) || !(startsAt < endsAt)) throw new Error('season is malformed')
  return { id, startsAt, endsAt, final: input.final === true }
}

/** The visitor's own record, or `null` when it cannot be read: the public board still shows. */
export function readableOwnEntry(value: unknown): BoardOwnEntry | null {
  try {
    return { ...parseOwnEntry(value), profile: normalizePlayerProfile(requireRecord(value, 'own').profile) }
  } catch {
    return null
  }
}

export function parseBoard(value: unknown): Board {
  const input = requireRecord(value, 'board')
  return {
    season: parseBoardSeason(input.season),
    podium: boardRows(input.podium, STATUE_PLACES, true),
    ranks: boardRows(input.ranks, LIST_PLACES, false),
    own: input.own ? readableOwnEntry(input.own) : null,
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

/** A season's board (`season` as `YYYY-MM`), or this month's; the visitor's own record comes with it. */
export async function fetchBoard(season: string | null, request: typeof fetch = fetch): Promise<Board> {
  const query = season ? `?season=${encodeURIComponent(season)}` : ''
  return parseBoard(await responseRecord(await sendToBoard(`/leaderboard${query}`, {}, request)))
}

/** What a report is about, and for a link, whether the profile is the reporter's own. */
export type ReportTarget = 'name' | 'character' | 'link'
export type ReportReason = 'mine' | 'other'

/** Reports someone's record; the board answers the same whatever it does, so the page says the same too. */
export async function reportBoardEntry(
  entryId: string,
  target: ReportTarget,
  reason: ReportReason,
  request: typeof fetch = fetch,
): Promise<void> {
  const path = `/entries/${encodeURIComponent(entryId)}/report`
  await sendToBoard(path, { method: 'POST', body: JSON.stringify({ target, reason }) }, request)
}

/** Deletes every run and record of this browser, in every season. */
export async function deleteOwnRecords(request: typeof fetch = fetch): Promise<void> {
  await sendToBoard('/entries/own', { method: 'DELETE' }, request)
}
