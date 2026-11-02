import { adminEmail, type AdminEmail } from './admins.js'
import type { Actor, LinkedUser } from './domain.js'
import { DomainError } from './domain.js'
import { guestbookEntryNotFound, isRevisable, parseGuestbookInput, type GuestbookEntry } from './guestbook.js'
import {
  assertRankedGame,
  derbyRunFlags,
  homeRunDerby,
  judgeDerbyRun,
  minimumRunMs,
  parseDerbySubmission,
  publicDerbyResult,
} from './homeRunDerby.js'
import {
  parseRunProfile,
  randomRunSeed,
  runLifetimeMs,
  runStanding,
  settleBoardEntry,
  type FinishedRun,
  type GameRun,
  type LeaderboardEntry,
  type RunStanding,
} from './leaderboard.js'
import { assertAdmin } from './policy.js'
import type { Store } from './store.js'
import {
  effectiveBallparkRules,
  parseResidentDialogueSource,
  parseTownLayout,
  rankingMonth,
  settleBallparkSettings,
  type ResidentDialogue,
  type ResidentDialogueSource,
  type TownLayout,
} from './town.js'

export type ResidentDialogueGenerator = (source: ResidentDialogueSource) => Promise<ResidentDialogue>

/** A finished run and where it left the visitor: their record on its board, that record's place, and the standing. */
export interface RunOutcome {
  run: GameRun
  entry: LeaderboardEntry | null
  rank: number
  standing: RunStanding
}

export class BackendService {
  constructor(
    private readonly store: Store,
    private readonly dialogueGenerator?: ResidentDialogueGenerator,
  ) {}

  getCurrentUser(actor: Actor): Promise<LinkedUser | null> {
    return actor.kind === 'linked' ? this.store.getUser(actor.userId) : Promise.resolve(null)
  }

  async getTown(townId: string): Promise<TownLayout> {
    const town = await this.store.getTown(townId)
    if (!town) throw new DomainError('NOT_FOUND', 'Town not found')
    return town
  }

  /**
   * Replaces the whole town; the editor sends the revision it loaded so a stale tab cannot overwrite newer work. The
   * ballpark rules in effect are settled against the stored town for the KST month of `now`. `now` is taken when the
   * request arrives, so a save that commits in the first moment of a month may still settle against the month before;
   * that window is accepted.
   */
  async saveTown(actor: Actor, townId: string, input: Record<string, unknown>, now = Date.now()): Promise<TownLayout> {
    assertAdmin(actor)
    const baseRevision = input.baseRevision
    if (typeof baseRevision !== 'number' || !Number.isInteger(baseRevision) || baseRevision < 0) {
      throw new DomainError('INVALID_INPUT', 'baseRevision must be a non-negative integer')
    }
    const layout = parseTownLayout(input)
    const stored = await this.store.getTown(townId)
    // A stale tab hears CONFLICT before its schedule is compared with newer work. A save that lands after this read
    // still moves the revision, so the store refuses this one rather than overwrite it.
    if ((stored?.revision ?? 0) !== baseRevision) {
      throw new DomainError('CONFLICT', 'The town changed since it was loaded')
    }
    const ballpark = settleBallparkSettings(layout.venues.ballpark, stored?.venues.ballpark ?? null, rankingMonth(now))
    return this.store.saveTown(townId, { ...layout, venues: { ...layout.venues, ballpark } }, baseRevision)
  }

  /** Drafts a resident's lines for the admin to review; nothing is stored until the admin saves the town. */
  async draftResidentDialogue(actor: Actor, input: unknown): Promise<ResidentDialogue> {
    assertAdmin(actor)
    const source = parseResidentDialogueSource(input)
    if (!this.dialogueGenerator) {
      throw new DomainError('NOT_CONFIGURED', 'Set OPENROUTER_API_KEY to draft resident dialogue')
    }
    return this.dialogueGenerator(source)
  }

  /** What every visitor sees: approved entries only. */
  listGuestbook(): Promise<GuestbookEntry[]> {
    return this.store.listGuestbookEntries({ status: 'approved', limit: 100 })
  }

  /** A browser without a visitor cookie has written nothing yet. */
  getOwnGuestbookEntry(visitorHash: string | null): Promise<GuestbookEntry | null> {
    return visitorHash ? this.store.getLatestGuestbookEntryByVisitor(visitorHash) : Promise.resolve(null)
  }

  /** Anyone may write one entry a day; it waits for the admin's approval before anyone else sees it. */
  async signGuestbook(visitorHash: string, input: Record<string, unknown>, now = Date.now()) {
    const fields = parseGuestbookInput(input)
    const latest = await this.store.getLatestGuestbookEntryByVisitor(visitorHash)
    if (latest && isRevisable(latest, now)) {
      throw new DomainError('CONFLICT', 'Revise the entry written today instead of adding another')
    }
    const timestamp = new Date(now).toISOString()
    const entry: GuestbookEntry = {
      id: crypto.randomUUID(),
      visitorHash,
      ...fields,
      status: 'pending',
      createdAt: timestamp,
      updatedAt: timestamp,
    }
    await this.store.insertGuestbookEntry(entry)
    return entry
  }

  /** `visitorHash` is `null` for a browser without a visitor cookie, which owns no entry. */
  async reviseGuestbookEntry(
    visitorHash: string | null,
    entryId: string,
    input: Record<string, unknown>,
    now = Date.now(),
  ) {
    const fields = parseGuestbookInput(input)
    const entry = await this.store.getGuestbookEntry(entryId)
    if (!entry || entry.visitorHash !== visitorHash) throw guestbookEntryNotFound()
    if (!isRevisable(entry, now))
      throw new DomainError('CONFLICT', 'Entries can only be revised on the day they are written')
    // `updatedAt` is the version an approval names, so every revision must move it forward, even within a millisecond.
    const updatedAt = new Date(Math.max(now, Date.parse(entry.updatedAt) + 1)).toISOString()
    const changes = { ...fields, status: 'pending' as const, updatedAt }
    const revised = await this.store.updateGuestbookEntry(entryId, entry.updatedAt, changes)
    if (!revised) throw new DomainError('CONFLICT', 'The entry changed while it was being revised')
    return revised
  }

  listGuestbookForReview(actor: Actor): Promise<GuestbookEntry[]> {
    assertAdmin(actor)
    return this.store.listGuestbookEntries({ limit: 200 })
  }

  /** `expectedUpdatedAt` is the version the admin read, so a revision made since then is never approved unseen. */
  async approveGuestbookEntry(actor: Actor, entryId: string, expectedUpdatedAt: unknown): Promise<GuestbookEntry> {
    assertAdmin(actor)
    if (typeof expectedUpdatedAt !== 'string') throw new DomainError('INVALID_INPUT', 'updatedAt is required')
    const approved = await this.store.updateGuestbookEntry(entryId, expectedUpdatedAt, { status: 'approved' })
    if (approved) return approved
    if (!(await this.store.getGuestbookEntry(entryId))) throw guestbookEntryNotFound()
    throw new DomainError('CONFLICT', 'The entry was revised after it was loaded')
  }

  async deleteGuestbookEntry(actor: Actor, entryId: string): Promise<void> {
    assertAdmin(actor)
    if (!(await this.store.getGuestbookEntry(entryId))) throw guestbookEntryNotFound()
    await this.store.deleteGuestbookEntry(entryId)
  }

  /** `currentEmail` is the signed-in admin's own address, which the editor shows as not removable. */
  async listAdmins(actor: Actor): Promise<{ admins: AdminEmail[]; currentEmail: string | null }> {
    assertAdmin(actor)
    return { admins: await this.store.listAdminEmails(), currentEmail: await this.signedInEmail(actor.userId) }
  }

  async signedInEmail(userId: string): Promise<string | null> {
    const user = await this.store.getUser(userId)
    return user?.email?.trim().toLowerCase() ?? null
  }

  /** The account behind the email becomes an admin at its next sign-in. */
  addAdmin(actor: Actor, email: unknown): Promise<AdminEmail> {
    assertAdmin(actor)
    return this.store.addAdminEmail(adminEmail(email))
  }

  /** An admin cannot remove their own email, so the editor cannot lock out the person using it. */
  async removeAdmin(actor: Actor, email: unknown): Promise<void> {
    assertAdmin(actor)
    const removed = adminEmail(email)
    if ((await this.signedInEmail(actor.userId)) === removed) {
      throw new DomainError('CONFLICT', 'You cannot remove your own admin email')
    }
    await this.store.removeAdminEmail(removed)
  }

  /**
   * Starts a ranked run for the visitor, abandoning their open one; anyone may start as many as they like. The run
   * takes the rules in effect for the KST month of `now`, the season it counts in wherever its result arrives.
   */
  async issueRun(game: string, visitorHash: string, now = Date.now(), seed = randomRunSeed()): Promise<GameRun> {
    const town = await this.openBallparkTown(game)
    // A record is public, so a site without a contact for takedown requests ranks nothing.
    if (!town.owner.contactEmail) {
      throw new DomainError('NOT_CONFIGURED', "Ranked runs need the town owner's contact email")
    }
    const season = rankingMonth(now)
    const run: GameRun = {
      id: crypto.randomUUID(),
      game,
      season,
      visitorHash,
      seed,
      rules: effectiveBallparkRules(town.venues.ballpark, season),
      status: 'issued',
      issuedAt: new Date(now).toISOString(),
      expiresAt: new Date(now + runLifetimeMs).toISOString(),
      submittedAt: null,
      inputLog: null,
      result: null,
      score: null,
      tiebreak: null,
      flags: [],
    }
    await this.store.issueRun(run)
    return run
  }

  /**
   * Records a run's result once, scored by the server from the run's own rules and seed and the raw log. A result sent
   * again gets the same answer; a run held for review leaves the visitor's record as it was. A malformed result
   * leaves the run open for a fixed client to send again, but one that ends too soon uses the run up.
   */
  async submitRunResult(
    game: string,
    visitorHash: string | null,
    runId: string,
    input: Record<string, unknown>,
    now = Date.now(),
  ): Promise<RunOutcome> {
    await this.openBallparkTown(game)
    const run = await this.ownRun(game, visitorHash, runId)
    if (run.status === 'scored' || run.status === 'flagged') return this.runOutcome(run, null, false)
    if (run.status !== 'issued' || Date.parse(run.expiresAt) <= now) {
      throw new DomainError('CONFLICT', 'This run can no longer be recorded')
    }
    const serverElapsedMs = now - Date.parse(run.issuedAt)
    const submittedAt = new Date(now).toISOString()
    if (serverElapsedMs < minimumRunMs(run.rules)) return this.rejectTooFastRun(run, input, submittedAt, now)
    const submission = parseDerbySubmission(input, run.rules)
    const profile = parseRunProfile(input.profile)
    const record = judgeDerbyRun(run.rules, run.seed, submission, serverElapsedMs)
    const flags = derbyRunFlags({ rules: run.rules, log: submission.log, record })
    const candidate = {
      entryId: crypto.randomUUID(),
      runId: run.id,
      score: record.homeRuns,
      tiebreak: record.homeRunDistanceDecimetres,
      result: publicDerbyResult(record),
      achievedAt: submittedAt,
      profile,
    }
    const finished: FinishedRun = {
      status: flags.length > 0 ? 'flagged' : 'scored',
      submittedAt,
      inputLog: submission.log,
      result: record,
      score: candidate.score,
      tiebreak: candidate.tiebreak,
      flags,
    }
    const settle =
      flags.length > 0
        ? null
        : (current: LeaderboardEntry | null, latest: LeaderboardEntry | null) =>
            settleBoardEntry(candidate, current, latest, run)
    const saved = await this.store.finishRun(run.id, run.visitorHash, finished, settle)
    // Another result for this run, or a new run, got there first: answer as the run now stands.
    if (!saved) return this.submitRunResult(game, visitorHash, runId, input, now)
    return this.runOutcome(saved.run, saved.settlement?.entry ?? null, saved.settlement?.consentNeeded ?? false)
  }

  /** The town whose ballpark plays `game`, while the admin shows it: a hidden ballpark neither issues nor records runs. */
  async openBallparkTown(game: string): Promise<TownLayout> {
    assertRankedGame(game)
    const town = await this.store.getTown(homeRunDerby.townId)
    if (!town?.venues.ballpark.visible) throw new DomainError('NOT_CONFIGURED', 'The ballpark is not open')
    return town
  }

  /** Someone else's run is reported exactly like a missing one, so run ids reveal nothing about their players. */
  async ownRun(game: string, visitorHash: string | null, runId: string): Promise<GameRun> {
    const run = visitorHash ? await this.store.getRun(runId) : null
    if (!run || run.visitorHash !== visitorHash || run.game !== game) {
      throw new DomainError('NOT_FOUND', 'Run not found')
    }
    return run
  }

  /** Using the run up stops a client from waiting and sending the same result again. */
  async rejectTooFastRun(
    run: GameRun,
    input: Record<string, unknown>,
    submittedAt: string,
    now: number,
  ): Promise<RunOutcome> {
    const tooFast: FinishedRun = {
      status: 'rejected',
      submittedAt,
      inputLog: null,
      result: null,
      score: null,
      tiebreak: null,
      flags: ['too-fast'],
    }
    const saved = await this.store.finishRun(run.id, run.visitorHash, tooFast, null)
    if (!saved) return this.submitRunResult(run.game, run.visitorHash, run.id, input, now)
    throw new DomainError('CONFLICT', 'The run ended sooner than its pitches can be played')
  }

  /** `entry` is the record the run just settled, if it did; otherwise the visitor's record is read as it stands now. */
  async runOutcome(run: GameRun, entry: LeaderboardEntry | null, consentNeeded: boolean): Promise<RunOutcome> {
    const record = entry ?? (await this.store.getBoardEntryByVisitor(run, run.visitorHash))
    const rank = record ? await this.store.rankOf(record) : 0
    return { run, entry: record, rank, standing: runStanding(run, record, rank, consentNeeded) }
  }
}
