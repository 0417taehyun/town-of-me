import { previousRankingMonth } from '../../data/ballparkRules'
import {
  boardName,
  fetchBoard,
  type IssuedRun,
  LeaderboardRequestError,
  type ListingChoice,
  type OwnBoardEntry,
  type RankedRunBody,
  type RunOutcome,
  type RunStanding,
  submitRankedRun,
} from '../../data/leaderboardApi'
import { normalizeLinkedInProfileUrl } from '../../data/linkedInProfile'
import type { PlayerProfile } from '../../data/playerProfile'
import type { BaseballPreview } from '../baseballRoute'
import { findsUsualTiming, type PracticeSample } from '../game/calibration'

// A run and the monthly board. A run asks the server for its rules and seed as it starts (useRankedRuns.ts); without
// an answer it plays all the same, unranked, and its result says so in a line. Its result goes to the board once the
// run is over, and nothing about the board ever holds up the next swing.

/** The board's first places, which stand as statues. */
export const STATUE_COUNT = 3
/** The longest a run waits for the board before it plays unranked (ms). */
export const ISSUE_TIMEOUT_MS = 3000
/** The longest a new run waits for the last run's result, still on its way, to arrive first (ms). */
export const RESULT_GRACE_MS = 1000
/** The longest pause between two tries at sending a result (ms). */
const longestRetryPauseMs = 30_000

/**
 * Why a run plays unranked: an admin's preview never is ranked, a practice that timed too few swings leaves nothing
 * the server's calibration takes, and `offline` is no board to reach (the network, or a ballpark hidden meanwhile).
 */
export type UnrankedReason = 'preview' | 'untimed' | 'offline'
/** Why a result was not saved: a failure another try may fix, a run past its time, or one a newer run replaced. */
export type UnsavedReason = 'failed' | 'expired' | 'replaced'

/** Where the latest run stands with the board, from its start to the board's answer. */
export type BoardRun =
  | { kind: 'unranked'; reason: UnrankedReason }
  | { kind: 'playing' }
  | { kind: 'saving' }
  | { kind: 'unsaved'; run: IssuedRun; body: RankedRunBody; reason: UnsavedReason }
  | { kind: 'saved'; standing: RunStanding }
  | { kind: 'deleted' }

/** What the result card says of the board. */
export type BoardLine =
  | { kind: 'saving' | 'reviewing' | 'excluded' | 'deleted' }
  | { kind: 'unranked'; reason: Exclude<UnrankedReason, 'preview'> }
  | { kind: 'unsaved'; reason: UnsavedReason }
  | { kind: 'statue' | 'newBest'; rank: number }
  | { kind: 'bestStands'; rank: number; homeRuns: number; totalDistanceDm: number }
  | { kind: 'offBoard' | 'consentNeeded'; wouldBeRank: number }

/** A run the board would refuse before it is asked: a preview, or one practice could not time. */
export function unrankedBeforeIssue(
  preview: BaseballPreview | null,
  practice: readonly PracticeSample[],
): UnrankedReason | null {
  if (preview !== null) return 'preview'
  return findsUsualTiming(practice) ? null : 'untimed'
}

/** Where a result that could not be sent leaves the run at `now`; a ballpark hidden meanwhile (503) ranks nothing. */
export function unsavedRun(run: IssuedRun, body: RankedRunBody, error: unknown, now: number): BoardRun {
  const status = error instanceof LeaderboardRequestError ? error.status : null
  if (status === 503) return { kind: 'unranked', reason: 'offline' }
  if (now >= run.expiresAt) return { kind: 'unsaved', run, body, reason: 'expired' }
  return { kind: 'unsaved', run, body, reason: status === 409 ? 'replaced' : 'failed' }
}

/**
 * How long to wait before sending a result again after try `attempt` (from 0) failed with `error`: twice as long each
 * time, never past the run's time, and not at all after a refusal (4xx) or a closed ballpark (503), which another try
 * would only repeat.
 */
export function retryPauseMs(error: unknown, attempt: number, expiresAt: number, now: number): number | null {
  const refused = error instanceof LeaderboardRequestError && (error.status < 500 || error.status === 503)
  const pauseMs = Math.min(longestRetryPauseMs, 1000 * 2 ** attempt)
  return refused || now + pauseMs >= expiresAt ? null : pauseMs
}

export function pause(milliseconds: number, signal?: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    const timer = window.setTimeout(resolve, milliseconds)
    signal?.addEventListener('abort', () => {
      window.clearTimeout(timer)
      reject(signal.reason)
    })
  })
}

/**
 * Sends a run's result, and again after each failure worth another try (retryPauseMs) until `signal` stops it;
 * `onRetry` hears before each pause. The server records a result once, so sending it again is safe.
 */
export function sendRankedResult(
  run: IssuedRun,
  body: RankedRunBody,
  signal: AbortSignal,
  onRetry: () => void,
  attempt = 0,
): Promise<RunOutcome> {
  return submitRankedRun(run.id, body).catch(async (error: unknown) => {
    const pauseMs = retryPauseMs(error, attempt, run.expiresAt, Date.now())
    if (pauseMs === null || signal.aborted) throw error
    onRetry()
    await pause(pauseMs, signal)
    return sendRankedResult(run, body, signal, onRetry, attempt + 1)
  })
}

/**
 * The name a run's result goes with: the board name of the visitor's latest listed record (`null` for an anonymous
 * batter), this month's or, before one, last month's, which a listing on either page may have set before this page
 * loaded; or else the character's. A result under another name looks like someone else's to the board, which then
 * takes the record off it with its name and link, or does not carry last month's listing over.
 */
export async function postedBoardName(characterName: string, request: typeof fetch = fetch) {
  const board = await fetchBoard(null, request)
  const own = board.own ?? (await fetchBoard(previousRankingMonth(board.season.id), request)).own
  return own?.listed ? own.name : characterName
}

/** What the result card says: nothing for a preview, whose badge says it is not ranked, or for a run still on. */
export function boardLine(boardRun: BoardRun | null, entry: OwnBoardEntry | null): BoardLine | null {
  if (boardRun === null || boardRun.kind === 'playing') return null
  if (boardRun.kind === 'unranked')
    return boardRun.reason === 'preview' ? null : { kind: 'unranked', reason: boardRun.reason }
  if (boardRun.kind === 'unsaved') return { kind: 'unsaved', reason: boardRun.reason }
  if (boardRun.kind === 'saved') return standingLine(boardRun.standing, entry)
  return { kind: boardRun.kind }
}

/**
 * The run's standing as the visitor's record now shows it (`entry`, which a listing changes after the run's answer): a
 * new best on the board is its place, or its statue; a run that did not beat the record says the record stands; a
 * record off the board says where it would be.
 */
export function standingLine(standing: RunStanding, entry: OwnBoardEntry | null): BoardLine {
  if (standing.kind === 'reviewing' || standing.kind === 'excluded') return { kind: standing.kind }
  if (entry === null || entry.rank === null) return { kind: 'excluded' }
  const { rank } = entry
  if (!entry.listed)
    return { kind: standing.kind === 'consentNeeded' ? 'consentNeeded' : 'offBoard', wouldBeRank: rank }
  if (!standing.personalBest) {
    return { kind: 'bestStands', rank, homeRuns: entry.homeRuns, totalDistanceDm: entry.totalDistanceDm }
  }
  return { kind: rank <= STATUE_COUNT ? 'statue' : 'newBest', rank }
}

/** A statue whose character has a LinkedIn link it does not show yet asks whether it should. */
export function offersLinkedIn(entry: OwnBoardEntry | null, profileUrl: string) {
  const statue = entry !== null && entry.listed && entry.rank !== null && entry.rank <= STATUE_COUNT
  return statue && entry.linkedIn === null && normalizeLinkedInProfileUrl(profileUrl) !== null
}

/** What the listing form found wrong, before anything is sent. */
export type ListingProblem = 'listedNeeded' | 'nameInvalid' | 'ownershipNeeded'
/** What went wrong with the listing card: the form, or the board's answer. */
export type ListingFailure = ListingProblem | 'saveFailed' | 'linkedInRefused'

/** The listing form as the visitor left it. */
export type ListingForm = { listed: boolean; name: string; linkedInOn: boolean; ownProfile: boolean }

/**
 * A record off the board goes on only with its box ticked (nothing is ever posted unasked); a name must be one the
 * board takes, and a link must be the visitor's own.
 */
export function listingProblem(form: ListingForm, wasListed: boolean): ListingProblem | null {
  if (!form.listed) return wasListed ? null : 'listedNeeded'
  if (form.name.trim() !== '' && boardName(form.name) === null) return 'nameInvalid'
  return form.linkedInOn && !form.ownProfile ? 'ownershipNeeded' : null
}

/**
 * The change the form asks for: an empty name posts an anonymous batter, and the link is sent when turned on (the
 * profile's address), turned off when the record has one, and otherwise left alone.
 */
export function listingChoice(
  form: ListingForm,
  profile: PlayerProfile,
  linkedInAddress: string | null,
  hasLinkedIn: boolean,
): ListingChoice {
  if (!form.listed) return { listed: false }
  const name = form.name.trim() === '' ? null : form.name
  const turnedOff = hasLinkedIn ? null : undefined
  const linkedIn = form.linkedInOn ? (linkedInAddress ?? undefined) : turnedOff
  return { listed: true, profile, name, linkedIn }
}

/** The board refuses a link it will not show (400) apart from any other failure, which another try may fix. */
export function saveFailure(error: unknown, choice: ListingChoice): ListingFailure {
  const refused = error instanceof LeaderboardRequestError && error.status === 400
  return refused && choice.listed && choice.linkedIn ? 'linkedInRefused' : 'saveFailed'
}
