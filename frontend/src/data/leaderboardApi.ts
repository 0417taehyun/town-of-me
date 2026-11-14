import type { DerbyInputLog, DerbyResult } from '../baseball/game/derbyScore'
import { requestJson, requireList, requireRecord, requireText, responseRecord } from './apiClient'
import { isRankingWeek } from './ballparkRules'
import { normalizeLinkedInProfileUrl } from './linkedInProfile'
import { BASEBALL_DIFFICULTIES, type BallparkRules } from './models'
import { normalizePlayerProfile, profileAppearance, type PlayerProfile } from './playerProfile'
import { isPitchCount } from './townApi'

// The wire format of the home run derby's weekly board (backend/README.md "Ranked runs"). The client sends no score
// the server keeps: a run's result is its input log, the totals the client worked out (which only decide whether the
// server marks the run for the admin), and who played it, the character's look and the board name when there is one.
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

/**
 * Where a run left the visitor's record on this week's board, as the server worked it out. A result stands at once:
 * `excluded` is a board the admin removed the visitor's record from.
 */
export type RunStanding =
  | { kind: 'excluded' }
  | { kind: 'ranked'; rank: number; personalBest: boolean }
  | { kind: 'unlisted' | 'consentNeeded'; wouldBeRank: number; personalBest: boolean }

export const NAME_STATUSES = ['shown', 'rejected'] as const
export const LINKED_IN_STATUSES = ['unverified', 'verified', 'reported'] as const
/** A name shows at once unless the server's automatic check refused it, or the admin took it off. */
export type NameStatus = (typeof NAME_STATUSES)[number]
/** A link shows once its visitor signed in with LinkedIn, and hides again while its profile's owner reports it. */
export type LinkedInStatus = (typeof LINKED_IN_STATUSES)[number]

/**
 * The visitor's own record on this week's board. Its LinkedIn link shows only as a hint, since the next person on a
 * shared computer sees this too.
 */
export type OwnBoardEntry = {
  listed: boolean
  name: string | null
  nameStatus: NameStatus | null
  takedown: boolean
  linkedIn: { profileHint: string; status: LinkedInStatus } | null
  homeRuns: number
  totalDistanceDm: number
  /** The place it holds, or would hold if listed; `null` once the admin removed it from the board. */
  rank: number | null
}

/** The visitor's own record as a season's board shows it, with the character it was posted with. */
export type BoardOwnEntry = OwnBoardEntry & { profile: PlayerProfile }

const nameStates = ['shown', 'anonymous'] as const
/** How anyone reads a record's name: shown, or an anonymous batter. */
export type NameState = (typeof nameStates)[number]

/**
 * A public record on a season's board. `name` is there only while shown; `profile` is `null` for the default batter
 * an anonymous record shows; `linkedInProfileUrl` is a statue's link its visitor signed in for, and never on a list row.
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

/** A KST week's board: its bounds, and whether it is over, so its order is final. */
export type BoardSeason = { id: string; startsAt: number; endsAt: number; final: boolean }

/**
 * A season's statues (places 1–3), its list (4–50), the visitor's own record on it, and whether this deployment can
 * verify a LinkedIn link at all (`linkedInAvailable`): without it the page offers none.
 */
export type Board = {
  season: BoardSeason
  podium: BoardRow[]
  ranks: BoardRow[]
  own: BoardOwnEntry | null
  linkedInAvailable: boolean
}

/** The server's answer to a run's result: the visitor's standing and their record on the run's board. */
export type RunOutcome = { standing: RunStanding; entry: OwnBoardEntry; linkedInAvailable: boolean }

/**
 * What the visitor asks of this week's record: off the board, or on it with this character, this name (`null` for an
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
  if (kind === 'excluded') return { kind }
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
    status: oneOf(input.status, LINKED_IN_STATUSES, 'entry.linkedIn.status'),
  }
}

export function parseOwnEntry(value: unknown): OwnBoardEntry {
  const input = requireRecord(value, 'entry')
  const named = typeof input.name === 'string' && input.name !== ''
  return {
    listed: input.listed === true,
    name: named ? (input.name as string) : null,
    nameStatus: named ? oneOf(input.nameStatus, NAME_STATUSES, 'entry.nameStatus') : null,
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
    name: nameState === 'shown' ? requireText(input.name, 'row.name') : null,
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
  if (!isRankingWeek(id) || !(startsAt < endsAt)) throw new Error('season is malformed')
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
    linkedInAvailable: input.linkedInAvailable === true,
  }
}

/** This week's statues as the town stands them: the KST week they belong to, and one row for each place held. */
export type Podium = { season: string; rows: BoardRow[] }

/** Statues read like a board's rows, and a place the server sent twice keeps its first: one statue to a pedestal. */
export function statueRows(value: unknown): BoardRow[] {
  const rows = boardRows(value, STATUE_PLACES, true)
  return rows.filter((row, index) => rows.findIndex(({ rank }) => rank === row.rank) === index)
}

/** The town's statues (`statueRows`). A malformed answer throws, and the town keeps what it had. */
export function parsePodium(value: unknown): Podium {
  const input = requireRecord(value, 'podium')
  const season = requireText(requireRecord(input.season, 'podium.season').id, 'podium.season.id')
  if (!isRankingWeek(season)) throw new Error('podium.season is malformed')
  return { season, rows: statueRows(input.podium) }
}

/** A finished season in the hall of fame: its id, and its statues as they stand now. */
export type HallOfFameSeason = { id: string; champions: BoardRow[] }

/** A season the page can show, or none: one malformed season never costs the visitor the others. */
export function readableHallOfFameSeason(value: unknown): HallOfFameSeason[] {
  try {
    const input = requireRecord(value, 'season')
    const id = requireText(input.id, 'season.id')
    return isRankingWeek(id) ? [{ id, champions: statueRows(input.champions) }] : []
  } catch {
    return []
  }
}

/** Every finished season, in the server's order, newest first. Belongs to no one, so it goes without the cookie. */
export async function fetchHallOfFame(request: typeof fetch = fetch): Promise<HallOfFameSeason[]> {
  const payload = await responseRecord(await sendToBoard('/hall-of-fame', { credentials: 'omit' }, request))
  return requireList(payload.seasons, 'seasons').flatMap(readableHallOfFameSeason)
}

/** A past season's board whose statues include the visitor's own record. */
export type OwnStatueBoard = Board & { own: BoardOwnEntry & { rank: number } }

/** Whether the visitor's record stands as a statue here: a place it only would hold if listed does not count. */
export function holdsOwnStatue(board: Board): board is OwnStatueBoard {
  const own = board.own
  return own !== null && own.listed && own.rank !== null && own.rank <= STATUE_PLACES.last
}

/**
 * The past seasons where the visitor's record is a statue, newest first. Only a season's board says whose record is
 * whose, one read a season, so a season without statues is skipped. Any failed read fails all of it: a partial list
 * would tell the visitor they stand on no pedestal they cannot see.
 */
export async function fetchOwnStatues(request: typeof fetch = fetch): Promise<OwnStatueBoard[]> {
  const seasons = await fetchHallOfFame(request)
  const standing = seasons.filter(({ champions }) => champions.length > 0)
  const boards = await Promise.all(standing.map(({ id }) => fetchBoard(id, request)))
  return boards.filter(holdsOwnStatue)
}

/**
 * This week's statues, without the visitor cookie: the answer belongs to no one, so every cache may share it for the
 * minute the server allows. `fresh` skips this browser's copy, as a new week starts.
 */
export async function fetchPodium(fresh: boolean, request: typeof fetch = fetch): Promise<Podium> {
  const init: RequestInit = { credentials: 'omit', cache: fresh ? 'reload' : 'default' }
  return parsePodium(await responseRecord(await sendToBoard('/podium', init, request)))
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
  return {
    standing: parseStanding(payload.standing),
    entry: parseOwnEntry(payload.entry),
    linkedInAvailable: payload.linkedInAvailable === true,
  }
}

/** Lists or unlists this week's record, or changes the name or link it shows. */
export async function updateOwnRecord(choice: ListingChoice, request: typeof fetch = fetch): Promise<OwnBoardEntry> {
  const init = { method: 'PUT', body: JSON.stringify(listingBody(choice)) }
  return parseOwnEntry((await responseRecord(await sendToBoard('/entries/own', init, request))).entry)
}

/**
 * Where the visitor signs in with LinkedIn for the unverified link on their record (this week's, or a past `season`'s).
 * The address comes from the server and the page then leaves for it, so only an https address is taken.
 */
export async function startLinkedInVerification(season: string | null, request: typeof fetch = fetch): Promise<string> {
  const query = season ? `?season=${encodeURIComponent(season)}` : ''
  const response = await sendToBoard(`/entries/own/linkedin-verification${query}`, { method: 'POST' }, request)
  const address = requireText((await responseRecord(response)).authorizationUrl, 'authorizationUrl')
  if (new URL(address).protocol !== 'https:') throw new Error('authorizationUrl must be an https address')
  return address
}

/**
 * Deletes the LinkedIn link of the visitor's record, this week's or a past `season`'s (a Monday's `YYYY-MM-DD`), whose
 * statue shows it until then, and answers the record without it.
 */
export async function turnOffLinkedIn(season: string | null, request: typeof fetch = fetch): Promise<OwnBoardEntry> {
  const query = season ? `?season=${encodeURIComponent(season)}` : ''
  const init = { method: 'PUT', body: JSON.stringify({ linkedIn: null }) }
  return parseOwnEntry((await responseRecord(await sendToBoard(`/entries/own${query}`, init, request))).entry)
}

/** Makes the visitor's statue on past `season` (a Monday's `YYYY-MM-DD`) an anonymous batter; this week's record stays as it is. */
export async function anonymizeOwnRecord(season: string, request: typeof fetch = fetch): Promise<void> {
  const path = `/entries/own?season=${encodeURIComponent(season)}`
  await sendToBoard(path, { method: 'PUT', body: JSON.stringify({ anonymize: true }) }, request)
}

/**
 * Leaves this browser a new visitor, for the next person on a shared device. It clears the cookie shared with the
 * guestbook, so it lies outside the board's path; the records stay, and this device can no longer change them.
 */
export async function forgetVisitor(request: typeof fetch = fetch): Promise<void> {
  const response = await requestJson('/v1/visitor/forget', { method: 'POST' }, request)
  if (!response.ok) throw new LeaderboardRequestError(response.status)
}

/** A season's board (`season` as its Monday's `YYYY-MM-DD`), or this week's; the visitor's own record comes with it. */
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
