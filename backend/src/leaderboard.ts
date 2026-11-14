import { randomInt } from 'node:crypto'
import { isDeepStrictEqual } from 'node:util'
import { parseCharacterAppearance, type CharacterAppearance } from './character.js'
import type { DerbyInputLog } from './derbyJudge/derbyScore.js'
import { DomainError } from './domain.js'
import type { DerbyRunRecord, PublicDerbyResult } from './homeRunDerby.js'
import { parseLinkedInRequest, profileHint, type LinkedInLink } from './leaderboardIdentity.js'
import type { BallparkRules } from './town.js'
import { nextRankingWeek, rankingDay, rankingWeekInput, rankingWeekStart } from './town.js'
import { inputRecord, invalidInput, optionalInput, singleLineText } from './validation.js'

// The weekly boards, apart from any one game: a board is a game and a KST week (its season), and each visitor has at
// most one record on it, their best scored run. The public order is home runs, then their distance, then whoever got
// there first; its first three are the statues. A result stands at once, wherever it places: nothing waits for the
// admin, who removes a bad record afterwards (`leaderboardReview.ts`).

/** A run is open this long after it is issued: a five-pitch run takes about two minutes, pauses included. */
export const runLifetimeMs = 10 * 60_000
/** The public order's first places, which stand as statues. */
export const statueCount = 3
/** A record whose best run arrived after its season ended may still be listed this long after; then that board is final. */
export const lateListingMs = 7 * 24 * 60 * 60_000
/** How many places the leaderboard lists. */
export const leaderboardLength = 50

/**
 * `issued` until a result arrives; a new run abandons the visitor's open one. A result is `scored` and reaches its
 * board at once, or `rejected` as impossible. `flagged` is only on runs stored before results stood at once: held for
 * review then and never accepted, so they never counted, and no run gets it any more.
 */
export type RunStatus = 'issued' | 'abandoned' | 'scored' | 'flagged' | 'rejected'

/** One ranked game the server started; its result is accepted once. */
export interface GameRun {
  id: string
  game: string
  /** The KST week it was issued in, by its Monday `YYYY-MM-DD`: its board, whenever its result arrives. */
  season: string
  /** Hash of the anonymous visitor cookie; client addresses are never stored. */
  visitorHash: string
  /** 32-bit unsigned. It plans the pitches only, and the landings have no randomness, so it is no secret. */
  seed: number
  /** The rules in effect for `season` when the run was issued. */
  rules: BallparkRules
  status: RunStatus
  issuedAt: string
  expiresAt: string
  submittedAt: string | null
  /** The parsed log the result was judged from: the practice numbers and four numbers per pitch, nothing else. */
  inputLog: DerbyInputLog | null
  result: DerbyRunRecord | null
  score: number | null
  tiebreak: number | null
  /** What looked unusual about a scored run, for the admin to read: marks that never keep it off the board. */
  flags: string[]
}

/** How a run ends: `scored` or `rejected`, with what the server worked out. */
export type FinishedRun = Pick<GameRun, 'inputLog' | 'result' | 'score' | 'tiebreak' | 'flags'> & {
  status: 'scored' | 'rejected'
  submittedAt: string
}

/** Where a page of a board's runs starts: after this run, newest first. */
export interface RunCursor {
  issuedAt: string
  id: string
}

export interface BoardKey {
  game: string
  season: string
}

/** A name shows at once; `rejected` is one the name check refused or the admin took off. */
export type NameStatus = 'shown' | 'rejected'
/**
 * `unverified` until the visitor signs in with LinkedIn (`linkVerification.ts`); `reported` once someone said the
 * profile is theirs, which hides the link until the admin decides.
 */
export type LinkedInStatus = 'unverified' | 'verified' | 'reported'

/** A record's optional LinkedIn link, which only its statue shows, and only once verified. */
export interface EntryLinkedIn {
  /** `https://www.linkedin.com/in/<id>`, the id percent-encoded. */
  profileUrl: string
  status: LinkedInStatus
  /**
   * The display name of the LinkedIn account that signed in, for the admin to compare with the address; nothing else
   * of that account is kept. `null` before sign-in, and on a link the admin confirmed before sign-in existed.
   */
  verifiedName: string | null
}

/** A visitor's best scored run on one board, and how it is shown. */
export interface LeaderboardEntry {
  id: string
  game: string
  season: string
  visitorHash: string
  /** `null` once that run is deleted. */
  bestRunId: string | null
  score: number
  tiebreak: number
  /** The best run's public result, copied so it outlives the run. */
  result: PublicDerbyResult
  /** When the best run's result arrived: the earlier of two equal records ranks first. */
  achievedAt: string
  /** Stored only while the record is listed. */
  authorName: string | null
  /** `null` exactly when there is no name. */
  nameStatus: NameStatus | null
  /** Kept while unlisted too, for the visitor's own view. */
  appearance: CharacterAppearance
  /** `false` shows the default batter instead: the admin hid the appearance, a report did, or a takedown. */
  appearancePublic: boolean
  /** Whether the visitor put the record on the public board. */
  listed: boolean
  /** The admin took the record off its board; the visitor's later runs on that board stay off too. */
  disqualified: boolean
  /** Only on a listed record, in any season, while its visitor keeps it on. */
  linkedIn: EntryLinkedIn | null
  /** Anonymised on a takedown request: on this board it never shows a name, link, or appearance again. */
  takedown: boolean
  createdAt: string
  /** Moves forward on every change, so a write names the version it read. */
  updatedAt: string
}

/** What a conditional entry update replaces. */
export type EntryChanges = Pick<
  LeaderboardEntry,
  | 'authorName'
  | 'nameStatus'
  | 'appearance'
  | 'appearancePublic'
  | 'listed'
  | 'disqualified'
  | 'linkedIn'
  | 'takedown'
  | 'updatedAt'
>

/**
 * What the visitor asks of this week's record: whether it is listed, the character and name it shows, and its link
 * (`undefined` leaves it, `null` turns it off).
 */
export interface OwnEntryUpdate {
  listed: boolean | null
  profile: RunProfile | null
  linkedIn: LinkedInLink | null | undefined
}

/** What the visitor may still do to a past season's record: anonymise it, or turn its link off. */
export interface PastEntryUpdate {
  anonymize: boolean
  linkedInOff: boolean
}

/** Who a run's result says played it: an appearance, and a name when the tab had one. */
export interface RunProfile {
  name: string | null
  appearance: CharacterAppearance
}

/** A scored run offered to its visitor's record on the run's board. */
export interface BoardCandidate {
  /** The id a first record on the board gets. */
  entryId: string
  runId: string
  score: number
  tiebreak: number
  result: PublicDerbyResult
  achievedAt: string
  profile: RunProfile
  /** What the profile's name gets if the record is new and listed (`leaderboardNameStatus`). */
  nameStatus: NameStatus
}

/** What a scored run does to its visitor's record. */
export interface EntrySettlement {
  entry: LeaderboardEntry
  /** Whether `entry` differs from the stored record, so the store writes it. */
  changed: boolean
  /** The browser's listed record looked like someone else, so this one stays off the board until they agree. */
  consentNeeded: boolean
}

/**
 * Decides, inside the step that finishes a scored run, the visitor's record from their record on the run's board
 * (`current`) and their latest record of the game (`latest`, read only when there is no `current`).
 */
export type SettleEntry = (current: LeaderboardEntry | null, latest: LeaderboardEntry | null) => EntrySettlement

/** A record and its place in the public order, or the place it would take. */
export interface RankedRecord {
  entry: LeaderboardEntry
  rank: number
}

/** The visitor's view of how a run went. */
export type RunStanding =
  | { kind: 'excluded' }
  | { kind: 'ranked'; rank: number; personalBest: boolean }
  | { kind: 'unlisted' | 'consentNeeded'; wouldBeRank: number; personalBest: boolean }

/** How the public reads a record's name. */
export type PublicNameState = 'shown' | 'anonymous'

/** A run's seed: any 32-bit unsigned integer. */
export function randomRunSeed(): number {
  return randomInt(0, 2 ** 32)
}

/** Where a record, or a run that would be one, falls in the public order. */
export type BoardPlace = Pick<LeaderboardEntry, 'id' | 'score' | 'tiebreak' | 'achievedAt'>

/** `left` before `right` in the public order: home runs, distance, the earlier record, then the id. */
export function boardOrder(left: BoardPlace, right: BoardPlace): number {
  return (
    right.score - left.score ||
    right.tiebreak - left.tiebreak ||
    textOrder(left.achievedAt, right.achievedAt) ||
    textOrder(left.id, right.id)
  )
}

/** Code-point order, like PostgreSQL compares ISO times and UUIDs, whatever the locale. */
export function textOrder(left: string, right: string): number {
  if (left === right) return 0
  return left < right ? -1 : 1
}

/** In the public order, where anyone sees it at its place: listed and not disqualified. */
export function isPublicEntry(entry: LeaderboardEntry): boolean {
  return entry.listed && !entry.disqualified
}

/** A record's version after a change at `now`: always later than `previous`, even within the same millisecond. */
export function nextVersion(previous: string, now: string): string {
  return new Date(Math.max(Date.parse(now), Date.parse(previous) + 1)).toISOString()
}

/** `changes` over the record as it stands, at a new version. */
export function entryChanges(entry: LeaderboardEntry, changes: Partial<EntryChanges>, now: string): EntryChanges {
  return {
    authorName: entry.authorName,
    nameStatus: entry.nameStatus,
    appearance: entry.appearance,
    appearancePublic: entry.appearancePublic,
    listed: entry.listed,
    disqualified: entry.disqualified,
    linkedIn: entry.linkedIn,
    takedown: entry.takedown,
    ...changes,
    updatedAt: nextVersion(entry.updatedAt, now),
  }
}

/** The season a request names, this one by default: malformed is `400`, and a season still to come has no board. */
export function boardSeason(requested: unknown, currentSeason: string): string {
  const season = requested === null ? currentSeason : rankingWeekInput(requested, 'season')
  if (season > currentSeason) throw new DomainError('NOT_FOUND', 'That season has not started')
  return season
}

/** The name is normalized like the board compares it; the appearance is the frontend `PlayerProfile` shape. */
export function parseRunProfile(value: unknown): RunProfile {
  const input = inputRecord(value, 'profile')
  return {
    name: optionalInput(input.name, (name) =>
      singleLineText(typeof name === 'string' ? name.normalize('NFKC') : name, 'profile.name', 24),
    ),
    appearance: parseCharacterAppearance(input, 'profile'),
  }
}

/** Whether `profile` could be the record's player: the same appearance, and the same name when the record has one. */
export function looksLike(entry: LeaderboardEntry, profile: RunProfile): boolean {
  const sameName = entry.authorName === null || entry.authorName === profile.name
  return sameName && isDeepStrictEqual(entry.appearance, profile.appearance)
}

export function settleBoardEntry(
  candidate: BoardCandidate,
  current: LeaderboardEntry | null,
  latest: LeaderboardEntry | null,
  board: BoardKey & { visitorHash: string },
): EntrySettlement {
  if (current) return revisedEntry(candidate, current)
  return firstEntry(candidate, latest, board)
}

/**
 * A visitor's first record on a board stays listed like their latest record of the game, unless it looks like
 * someone else played: then nobody's earlier consent publishes it. Nor does a record taken down, and a link is never
 * carried over.
 */
export function firstEntry(
  candidate: BoardCandidate,
  latest: LeaderboardEntry | null,
  board: BoardKey & { visitorHash: string },
): EntrySettlement {
  const wasListed = latest?.listed === true && !latest.takedown
  const sameVisitor = latest !== null && looksLike(latest, candidate.profile)
  const listed = wasListed && sameVisitor
  const name = listed ? candidate.profile.name : null
  return {
    entry: {
      id: candidate.entryId,
      game: board.game,
      season: board.season,
      visitorHash: board.visitorHash,
      bestRunId: candidate.runId,
      score: candidate.score,
      tiebreak: candidate.tiebreak,
      result: candidate.result,
      achievedAt: candidate.achievedAt,
      authorName: name,
      nameStatus: name === null ? null : candidate.nameStatus,
      appearance: candidate.profile.appearance,
      appearancePublic: true,
      listed,
      disqualified: false,
      linkedIn: null,
      takedown: false,
      createdAt: candidate.achievedAt,
      updatedAt: candidate.achievedAt,
    },
    changed: true,
    consentNeeded: wasListed && !sameVisitor,
  }
}

/**
 * A better run replaces the record, though a disqualification stays, so a removed visitor's replay on that board does
 * not put them back; an equal one keeps the earlier record. A run that looks like someone else's takes a listed record off the board with its name and link, so
 * a shared browser never publishes the next player's score under the last one's consent.
 */
export function revisedEntry(candidate: BoardCandidate, current: LeaderboardEntry): EntrySettlement {
  const improved =
    candidate.score > current.score || (candidate.score === current.score && candidate.tiebreak > current.tiebreak)
  const listed = current.listed && looksLike(current, candidate.profile)
  if (!improved && listed === current.listed) return { entry: current, changed: false, consentNeeded: false }
  const best = improved
    ? {
        bestRunId: candidate.runId,
        score: candidate.score,
        tiebreak: candidate.tiebreak,
        result: candidate.result,
        achievedAt: candidate.achievedAt,
        appearance: candidate.profile.appearance,
      }
    : {}
  return {
    entry: {
      ...current,
      ...best,
      listed,
      authorName: listed ? current.authorName : null,
      nameStatus: listed ? current.nameStatus : null,
      linkedIn: listed ? current.linkedIn : null,
      updatedAt: nextVersion(current.updatedAt, candidate.achievedAt),
    },
    changed: true,
    consentNeeded: current.listed && !listed,
  }
}

/**
 * Listing needs the profile, since the name is stored from then on; unlisting needs nothing else, and a link alone is
 * enough to turn it on or off.
 */
export function parseOwnEntryUpdate(input: Record<string, unknown>): OwnEntryUpdate {
  const listed = input.listed ?? null
  if (listed !== null && typeof listed !== 'boolean') throw invalidInput('listed must be a boolean')
  const profile = optionalInput(input.profile, parseRunProfile)
  const linkedIn = input.linkedIn === undefined ? undefined : optionalInput(input.linkedIn, parseLinkedInRequest)
  if (listed === true && !profile) throw invalidInput('profile is required to list the record')
  if (listed === null && !profile && linkedIn === undefined) throw invalidInput('Send listed, profile, or linkedIn')
  return { listed, profile, linkedIn }
}

/** A final record of a past season only takes `{ anonymize: true }` and `{ linkedIn: null }`. */
export function parsePastEntryUpdate(input: Record<string, unknown>): PastEntryUpdate {
  const anonymize = input.anonymize ?? false
  if (anonymize !== true && anonymize !== false) throw invalidInput('anonymize must be true')
  if (input.linkedIn !== undefined && input.linkedIn !== null) {
    throw invalidInput("A past season's link can only be turned off")
  }
  if (input.listed !== undefined || input.profile !== undefined) {
    throw invalidInput("A past season's record only takes anonymize or linkedIn: null")
  }
  const update = { anonymize, linkedInOff: input.linkedIn === null }
  if (!update.anonymize && !update.linkedInOff) throw invalidInput('Send anonymize: true or linkedIn: null')
  return update
}

/**
 * The visitor's change to this week's record: a listed record shows the profile's name, an unlisted one keeps none
 * and no link. A new name gets its checked status (`newNameStatus`) while the record's own name keeps its status, and
 * a taken-down record stays nameless.
 */
export function ownEntryChanges(
  entry: LeaderboardEntry,
  update: OwnEntryUpdate,
  now: string,
  newNameStatus: NameStatus,
): EntryChanges {
  const listed = update.listed ?? entry.listed
  const named = listed && !entry.takedown
  const authorName = named ? (update.profile ? update.profile.name : entry.authorName) : null
  return entryChanges(
    entry,
    {
      listed,
      authorName,
      nameStatus: nameStatusFor(entry, authorName, newNameStatus),
      appearance: update.profile?.appearance ?? entry.appearance,
      linkedIn: ownLinkedIn(entry, update.linkedIn, listed),
    },
    now,
  )
}

/** The record's own name keeps its status; any other gets `newNameStatus`, the checked status of the new one. */
export function nameStatusFor(
  entry: LeaderboardEntry,
  name: string | null,
  newNameStatus: NameStatus,
): NameStatus | null {
  if (name === null) return null
  return name === entry.authorName ? entry.nameStatus : newNameStatus
}

/**
 * The link stays unless the visitor turns it off or unlists the record. A new address is stored `unverified`, which
 * nobody else sees until the visitor signs in with LinkedIn; the address the record already has keeps its state.
 */
export function ownLinkedIn(
  entry: LeaderboardEntry,
  requested: LinkedInLink | null | undefined,
  listed: boolean,
): EntryLinkedIn | null {
  if (!listed || requested === null) return null
  if (requested === undefined || requested.profileUrl === entry.linkedIn?.profileUrl) return entry.linkedIn
  return { profileUrl: requested.profileUrl, status: 'unverified', verifiedName: null }
}

/** Anonymising a past record drops its name and link; the score keeps its place. */
export function pastEntryChanges(entry: LeaderboardEntry, update: PastEntryUpdate, now: string): EntryChanges {
  const anonymized = update.anonymize ? { authorName: null, nameStatus: null } : {}
  return entryChanges(entry, { ...anonymized, linkedIn: null }, now)
}

/** How the run left its visitor: a disqualified record is off this board whatever the run did. */
export function runStanding(runId: string, entry: LeaderboardEntry, rank: number, consentNeeded: boolean): RunStanding {
  if (entry.disqualified) return { kind: 'excluded' }
  const personalBest = entry.bestRunId === runId
  if (entry.listed) return { kind: 'ranked', rank, personalBest }
  return { kind: consentNeeded ? 'consentNeeded' : 'unlisted', wouldBeRank: rank, personalBest }
}

/** A name shows unless it was refused or taken off; a record without one is an anonymous batter. */
export function publicNameState(entry: LeaderboardEntry): PublicNameState {
  return entry.authorName !== null && entry.nameStatus === 'shown' ? 'shown' : 'anonymous'
}

/**
 * A record as anyone sees it: no visitor hash, admin state, or exact time. An anonymous batter keeps their score but
 * shows the default silhouette, since a character can be recognized without a name, and so does a hidden appearance.
 */
export function rankedEntry(entry: LeaderboardEntry, rank: number) {
  const nameState = publicNameState(entry)
  const silhouette = nameState === 'anonymous' || !entry.appearancePublic
  return {
    id: entry.id,
    rank,
    name: nameState === 'shown' ? entry.authorName : null,
    nameState,
    profile: silhouette ? { kind: 'default' as const } : entry.appearance,
    homeRuns: entry.score,
    totalDistanceDm: entry.tiebreak,
    achievedOn: rankingDay(entry.achievedAt),
  }
}

/** A statue, this week's or a past season's: a public record with its LinkedIn link once its visitor signed in. */
export function podiumEntry(entry: LeaderboardEntry, rank: number) {
  const linkedIn = entry.linkedIn?.status === 'verified' ? { linkedInProfileUrl: entry.linkedIn.profileUrl } : {}
  return { ...rankedEntry(entry, rank), ...linkedIn }
}

/**
 * The visitor's own record: the real name and its status, its place or the place it would have if listed, and its
 * link by a hint only, since the next person on a shared device sees this too.
 */
export function ownEntry(entry: LeaderboardEntry, rank: number) {
  const linkedIn = entry.linkedIn
  return {
    id: entry.id,
    season: entry.season,
    listed: entry.listed,
    name: entry.authorName,
    nameStatus: entry.nameStatus,
    disqualified: entry.disqualified,
    profile: entry.takedown ? { kind: 'default' as const } : entry.appearance,
    appearancePublic: entry.appearancePublic,
    takedown: entry.takedown,
    linkedIn: linkedIn && { profileHint: profileHint(linkedIn.profileUrl), status: linkedIn.status },
    homeRuns: entry.score,
    totalDistanceDm: entry.tiebreak,
    achievedAt: entry.achievedAt,
    rank: entry.disqualified ? null : rank,
  }
}

/** A season's bounds; a season before `currentSeason` is final. */
export function seasonView(season: string, currentSeason: string) {
  return {
    id: season,
    startsAt: new Date(rankingWeekStart(season)).toISOString(),
    endsAt: new Date(rankingWeekStart(nextRankingWeek(season))).toISOString(),
    final: season < currentSeason,
  }
}

/** Until when a record of `season` whose best run arrived late may still be listed. */
export function lateListingDeadline(season: string): number {
  return rankingWeekStart(nextRankingWeek(season)) + lateListingMs
}

/**
 * Whether a past season's record still takes its visitor's listing like this week's: its best run, issued in the
 * season, arrived only after the season ended, so the visitor never had the chance. Only for a week; then that board
 * is final.
 */
export function listableAfterSeason(bestRun: GameRun | null, now: number): boolean {
  if (!bestRun?.submittedAt || now >= lateListingDeadline(bestRun.season)) return false
  return Date.parse(bestRun.submittedAt) >= rankingWeekStart(nextRankingWeek(bestRun.season))
}
