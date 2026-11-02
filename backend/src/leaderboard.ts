import { randomInt } from 'node:crypto'
import { isDeepStrictEqual } from 'node:util'
import { parseCharacterAppearance, type CharacterAppearance } from './character.js'
import type { DerbyInputLog } from './derbyJudge/derbyScore.js'
import type { DerbyRunRecord, PublicDerbyResult } from './homeRunDerby.js'
import type { BallparkRules } from './town.js'
import { inputRecord, optionalInput, singleLineText } from './validation.js'

// The monthly boards, apart from any one game: a board is a game and a KST month (its season), and each visitor has at
// most one record on it, their best accepted run. The public order is home runs, then their distance, then whoever got
// there first; its first three are the statues. A run held for review never touches a record, so it never stands.

/** A run is open this long after it is issued: a five-pitch run takes about two minutes, pauses included. */
export const runLifetimeMs = 10 * 60_000

/** `issued` until a result arrives; a new run abandons the visitor's open one. Only `scored` runs reach a board. */
export type RunStatus = 'issued' | 'abandoned' | 'scored' | 'flagged' | 'rejected'

/** One ranked game the server started; its result is accepted once. */
export interface GameRun {
  id: string
  game: string
  /** The KST month it was issued in, `YYYY-MM`: its board, whenever its result arrives. */
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
  /** Why a run is held for review, or why it was rejected. */
  flags: string[]
}

/** How a run ends: `scored`, `flagged`, or `rejected`, with what the server worked out. */
export type FinishedRun = Pick<GameRun, 'status' | 'inputLog' | 'result' | 'score' | 'tiebreak' | 'flags'> & {
  submittedAt: string
}

export interface BoardKey {
  game: string
  season: string
}

/** A name waits for the admin before anyone else reads it. */
export type NameStatus = 'pending' | 'approved' | 'rejected'
/** `pending` does not hide a record; only `disqualified` takes it off the board. */
export type ReviewStatus = 'pending' | 'approved' | 'disqualified'

/** A visitor's best accepted run on one board, and how it is shown. */
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
  /** Whether the visitor put the record on the public board. */
  listed: boolean
  reviewStatus: ReviewStatus
  createdAt: string
  /** Moves forward on every change, so a write names the version it read. */
  updatedAt: string
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

/** The visitor's view of how a run went. */
export type RunStanding =
  | { kind: 'reviewing' }
  | { kind: 'excluded' }
  | { kind: 'ranked'; rank: number; personalBest: boolean }
  | { kind: 'unlisted' | 'consentNeeded'; wouldBeRank: number; personalBest: boolean }

/** A run's seed: any 32-bit unsigned integer. */
export function randomRunSeed(): number {
  return randomInt(0, 2 ** 32)
}

/** `left` before `right` in the public order: home runs, distance, the earlier record, then the id. */
export function boardOrder(left: LeaderboardEntry, right: LeaderboardEntry): number {
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

/** On the public board: listed and not disqualified. */
export function isPublicEntry(entry: LeaderboardEntry): boolean {
  return entry.listed && entry.reviewStatus !== 'disqualified'
}

/** A record's version after a change at `now`: always later than `previous`, even within the same millisecond. */
export function nextVersion(previous: string, now: string): string {
  return new Date(Math.max(Date.parse(now), Date.parse(previous) + 1)).toISOString()
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
 * someone else played: then nobody's earlier consent publishes it.
 */
export function firstEntry(
  candidate: BoardCandidate,
  latest: LeaderboardEntry | null,
  board: BoardKey & { visitorHash: string },
): EntrySettlement {
  const wasListed = latest?.listed === true
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
      nameStatus: name === null ? null : 'pending',
      appearance: candidate.profile.appearance,
      listed,
      reviewStatus: 'pending',
      createdAt: candidate.achievedAt,
      updatedAt: candidate.achievedAt,
    },
    changed: true,
    consentNeeded: wasListed && !sameVisitor,
  }
}

/**
 * A better run replaces the record and returns it to review, though a disqualification stays; an equal one keeps the
 * earlier record. A run that looks like someone else's takes a listed record off the board with its name, so a shared
 * browser never publishes the next player's score under the last one's consent.
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
        reviewStatus: current.reviewStatus === 'disqualified' ? current.reviewStatus : ('pending' as const),
      }
    : {}
  return {
    entry: {
      ...current,
      ...best,
      listed,
      authorName: listed ? current.authorName : null,
      nameStatus: listed ? current.nameStatus : null,
      updatedAt: nextVersion(current.updatedAt, candidate.achievedAt),
    },
    changed: true,
    consentNeeded: current.listed && !listed,
  }
}

/** A run held for review leaves the record as it was; a disqualified record is off this board whatever the run did. */
export function runStanding(
  run: GameRun,
  entry: LeaderboardEntry | null,
  rank: number,
  consentNeeded: boolean,
): RunStanding {
  if (run.status !== 'scored' || !entry) return { kind: 'reviewing' }
  if (entry.reviewStatus === 'disqualified') return { kind: 'excluded' }
  const personalBest = entry.bestRunId === run.id
  if (entry.listed) return { kind: 'ranked', rank, personalBest }
  return { kind: consentNeeded ? 'consentNeeded' : 'unlisted', wouldBeRank: rank, personalBest }
}

/** The visitor's own record: the real name and its status, and its place, or the place it would have if listed. */
export function ownEntry(entry: LeaderboardEntry, rank: number) {
  const disqualified = entry.reviewStatus === 'disqualified'
  return {
    id: entry.id,
    season: entry.season,
    listed: entry.listed,
    name: entry.authorName,
    nameStatus: entry.nameStatus,
    disqualified,
    profile: entry.appearance,
    homeRuns: entry.score,
    totalDistanceDm: entry.tiebreak,
    achievedAt: entry.achievedAt,
    rank: disqualified ? null : rank,
  }
}
