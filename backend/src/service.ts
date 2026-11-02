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
  boardSeason,
  leaderboardLength,
  ownEntryChanges,
  parseOwnEntryUpdate,
  parsePastEntryUpdate,
  parseRunProfile,
  pastEntryChanges,
  randomRunSeed,
  runLifetimeMs,
  runStanding,
  settleBoardEntry,
  statueCount,
  type BoardCandidate,
  type BoardKey,
  type EntryChanges,
  type FinishedRun,
  type GameRun,
  type LeaderboardEntry,
  type NameStatus,
  type RunStanding,
  type SettleEntry,
} from './leaderboard.js'
import {
  leaderboardNameStatus,
  linkBlockHash,
  ownershipCode,
  profileIdOf,
  reservedNameForms,
  takenNameForms,
  townLinkedInIds,
  type LinkedInLink,
} from './leaderboardIdentity.js'
import {
  acceptanceDeadline,
  entryReviewChanges,
  forgetQuietReporters,
  fromVersion,
  heldRunCandidate,
  isNewVisitor,
  listableAfterSeason,
  parseEntryReport,
  parseReportResolution,
  previousRankingMonth,
  recentReports,
  reportedChanges,
  reportsPerHour,
  reportSweepIntervalMs,
  reviewQueue,
  supersededKeeps,
  versionInput,
  type EntryReviewAction,
  type ReviewBoard,
} from './leaderboardReview.js'
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

/** A board's top places in public order, and the visitor's own record with its place. */
export interface Leaderboard {
  season: string
  currentSeason: string
  entries: LeaderboardEntry[]
  own: RankedRecord | null
}

/** A record and its place in the public order, or the place it would take. */
export interface RankedRecord {
  entry: LeaderboardEntry
  rank: number
}

export class BackendService {
  /** When each visitor's recent reports came, in this process only: never written anywhere, gone on restart. */
  private readonly reportTimes = new Map<string, number[]>()
  /** When `reportTimes` last forgot its quiet visitors. */
  private reportTimesSweptAt = 0

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
      profile: null,
      reviewedAt: null,
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
    const held = flags.length > 0
    const candidate = {
      entryId: crypto.randomUUID(),
      runId: run.id,
      score: record.homeRuns,
      tiebreak: record.homeRunDistanceDecimetres,
      result: publicDerbyResult(record),
      achievedAt: submittedAt,
      profile,
      reviewStatus: 'pending' as const,
    }
    const finished: FinishedRun = {
      status: held ? 'flagged' : 'scored',
      submittedAt,
      inputLog: submission.log,
      result: record,
      score: candidate.score,
      tiebreak: candidate.tiebreak,
      flags,
      profile: held ? profile : null,
    }
    const settle = held ? null : await this.settlementFor(run, candidate)
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
      profile: null,
    }
    const saved = await this.store.finishRun(run.id, run.visitorHash, tooFast, null)
    if (!saved) return this.submitRunResult(run.game, run.visitorHash, run.id, input, now)
    throw new DomainError('CONFLICT', 'The run ended sooner than its pitches can be played')
  }

  /**
   * A season's board, this KST month's by default, kept with no end date. A season still to come has none. Reads stay
   * open while the ballpark is hidden: the frontend decides what a hidden venue shows.
   */
  async getLeaderboard(
    game: string,
    visitorHash: string | null,
    requestedSeason: string | null,
    now = Date.now(),
  ): Promise<Leaderboard> {
    assertRankedGame(game)
    const currentSeason = rankingMonth(now)
    const season = boardSeason(requestedSeason, currentSeason)
    const board = { game, season }
    const own = visitorHash ? await this.store.getBoardEntryByVisitor(board, visitorHash) : null
    return {
      season,
      currentSeason,
      entries: await this.store.listBoard(board, leaderboardLength),
      own: own && { entry: own, rank: await this.store.rankOf(own) },
    }
  }

  /** This KST month's statues: the first three of its public order, read by the town without a visitor cookie. */
  async getPodium(game: string, now = Date.now()): Promise<{ season: string; entries: LeaderboardEntry[] }> {
    assertRankedGame(game)
    const season = rankingMonth(now)
    return { season, entries: await this.store.listBoard({ game, season }, statueCount) }
  }

  /**
   * The visitor lists or unlists this month's record, changes the character and name it shows, or turns its link on or
   * off. A past season's record (`season`) may only be anonymised or have its link turned off, unless its best run
   * came in after the season ended (`listableAfterSeason`): then it takes the same changes as this month's.
   */
  async updateOwnEntry(
    game: string,
    visitorHash: string | null,
    input: Record<string, unknown>,
    requestedSeason: string | null = null,
    now = Date.now(),
  ): Promise<RankedRecord> {
    assertRankedGame(game)
    const currentSeason = rankingMonth(now)
    const board = { game, season: boardSeason(requestedSeason, currentSeason) }
    const at = new Date(now).toISOString()
    const entry = await this.ownEntryOn(board, visitorHash)
    if (board.season < currentSeason && !(await this.isListableLate(entry, now))) {
      return this.saveOwnChanges(entry, pastEntryChanges(entry, parsePastEntryUpdate(input), at))
    }
    const update = parseOwnEntryUpdate(input)
    const listed = update.listed ?? entry.listed
    if (update.linkedIn && (!listed || entry.takedown)) {
      throw new DomainError('CONFLICT', 'Only a listed record that was not taken down shows a link')
    }
    if (update.linkedIn) await this.assertLinkAllowed(update.linkedIn)
    const nameStatus = await this.newNameStatus(entry, update.profile?.name ?? null)
    const changes = ownEntryChanges(entry, update, at, { nameStatus, linkedInCode: ownershipCode() })
    return this.saveOwnChanges(entry, changes)
  }

  /** A browser without a visitor cookie, or without a record on the board, has nothing to change. */
  async ownEntryOn(board: BoardKey, visitorHash: string | null): Promise<LeaderboardEntry> {
    const entry = visitorHash ? await this.store.getBoardEntryByVisitor(board, visitorHash) : null
    if (!entry) throw new DomainError('NOT_FOUND', 'No record that month')
    return entry
  }

  /** Whether a past season's record still takes its visitor's listing, from its best run. */
  async isListableLate(entry: LeaderboardEntry, now: number): Promise<boolean> {
    const bestRun = entry.bestRunId === null ? null : await this.store.getRun(entry.bestRunId)
    return listableAfterSeason(bestRun, now)
  }

  async saveOwnChanges(entry: LeaderboardEntry, changes: EntryChanges): Promise<RankedRecord> {
    const updated = await this.store.updateEntry(entry.id, entry.updatedAt, changes)
    if (!updated) throw new DomainError('CONFLICT', 'The record changed while it was being updated')
    const superseded = supersededKeeps(entry, updated)
    if (superseded.length > 0) await this.store.forgetKeptReports(entry.id, superseded)
    return { entry: updated, rank: await this.store.rankOf(updated) }
  }

  /** A link the town shows already, or one a takedown blocked, cannot be claimed. */
  async assertLinkAllowed(link: LinkedInLink): Promise<void> {
    const town = await this.store.getTown(homeRunDerby.townId)
    const claimed = townLinkedInIds(town).includes(link.profileId.toLowerCase())
    if (claimed || (await this.store.isLinkBlocked(await linkBlockHash(link.profileId)))) {
      throw new DomainError('INVALID_INPUT', 'This link cannot be used')
    }
  }

  /** The status a name the record does not have yet would get; the record's own name keeps the one it has. */
  async newNameStatus(entry: LeaderboardEntry, name: string | null): Promise<NameStatus> {
    if (name === null || name === entry.authorName) return 'pending'
    return this.nameStatusOn(entry, entry.visitorHash, name)
  }

  /** The board's name check, against the stored town and the board's approved names. */
  async nameStatusOn(board: BoardKey, visitorHash: string, name: string | null): Promise<'pending' | 'rejected'> {
    if (name === null) return 'pending'
    const [town, entries] = await Promise.all([this.store.getTown(homeRunDerby.townId), this.store.listEntries(board)])
    return leaderboardNameStatus(name, {
      reserved: reservedNameForms(town),
      taken: takenNameForms(entries, visitorHash),
    })
  }

  /**
   * How a scored or accepted run settles its visitor's record. Only a first record on the board can take the profile's
   * name, so the name is checked only then; a record that appears meanwhile settles with the name pending, which shows
   * nothing until it is approved.
   */
  async settlementFor(run: GameRun, candidate: Omit<BoardCandidate, 'nameStatus'>): Promise<SettleEntry> {
    const existing = await this.store.getBoardEntryByVisitor(run, run.visitorHash)
    const nameStatus = existing ? 'pending' : await this.nameStatusOn(run, run.visitorHash, candidate.profile.name)
    return (current, latest) => settleBoardEntry({ ...candidate, nameStatus }, current, latest, run)
  }

  /** Deletes the visitor's runs and records of the game in every season at once; a statue makes way for the next. */
  async deleteOwnRecords(game: string, visitorHash: string | null): Promise<void> {
    assertRankedGame(game)
    if (visitorHash) await this.store.eraseVisitorGameData(game, visitorHash)
  }

  /**
   * Takes a report on a record's name, character, or link, from any season. It answers the same whatever happens, so
   * nothing can be learned from it, and it counts only from a visitor who has played, about someone else's record, at
   * most five an hour: a record's owner cannot report their own link to fix it as restored.
   */
  async reportEntry(
    game: string,
    visitorHash: string | null,
    entryId: string,
    input: Record<string, unknown>,
    now = Date.now(),
  ): Promise<void> {
    assertRankedGame(game)
    const report = parseEntryReport(input)
    this.sweepReportTimes(now)
    const recent = visitorHash ? recentReports(this.reportTimes.get(visitorHash) ?? [], now) : []
    if (!visitorHash || recent.length >= reportsPerHour) return
    const entry = await this.store.getEntry(entryId)
    if (!entry || entry.game !== game || entry.visitorHash === visitorHash) return
    if (!(await this.store.hasSubmittedRun(game, visitorHash))) return
    this.reportTimes.set(visitorHash, [...recent, now])
    const at = new Date(now).toISOString()
    const earlier = await this.store.listReports(entry)
    const kept = earlier.some(
      (other) => other.entryId === entry.id && other.target === report.target && other.resolution === 'kept',
    )
    await this.store.addReport({
      id: crypto.randomUUID(),
      entryId: entry.id,
      ...report,
      createdAt: at,
      resolvedAt: null,
      resolution: null,
    })
    const hidden = reportedChanges(entry, report, kept, ownershipCode(), at)
    // A record that changed meanwhile keeps its new version; the report still waits in the queue.
    if (hidden) await this.store.updateEntry(entry.id, entry.updatedAt, hidden)
  }

  /** Forgets the visitors with no report in the last hour, at most once a minute, so the counter cannot keep growing. */
  sweepReportTimes(now: number): void {
    if (now - this.reportTimesSweptAt < reportSweepIntervalMs) return
    forgetQuietReporters(this.reportTimes, now)
    this.reportTimesSweptAt = now
  }

  /** The review queue of one season, or of this season and the last by default (`leaderboardReview.ts`). */
  async getReviewQueue(actor: Actor, game: string, requestedSeason: string | null, now = Date.now()) {
    assertAdmin(actor)
    assertRankedGame(game)
    const currentSeason = rankingMonth(now)
    const seasons =
      requestedSeason === null
        ? [currentSeason, previousRankingMonth(currentSeason)]
        : [boardSeason(requestedSeason, currentSeason)]
    const town = await this.store.getTown(homeRunDerby.townId)
    const boards = await Promise.all(seasons.map((season) => this.reviewBoard({ game, season })))
    return reviewQueue(boards, { town, currentSeason, now })
  }

  async reviewBoard(board: BoardKey): Promise<ReviewBoard> {
    const [entries, runs, reports, counts] = await Promise.all([
      this.store.listEntries(board),
      this.store.listRunsForReview(board),
      this.store.listReports(board),
      this.store.countRunsByVisitor(board),
    ])
    return { ...board, entries, runs, reports, counts }
  }

  /**
   * An admin's action on a record (`entryReviewChanges`), only from the version they read: a record changed since is
   * `409` and stays as it is. Disqualifying, hiding, or anonymising a statue lets the next record stand at once.
   */
  async reviewEntry(
    actor: Actor,
    game: string,
    entryId: string,
    action: EntryReviewAction,
    input: Record<string, unknown>,
    now = Date.now(),
  ): Promise<RankedRecord> {
    assertAdmin(actor)
    assertRankedGame(game)
    const expectedUpdatedAt = versionInput(input.updatedAt, 'updatedAt')
    const entry = await this.store.getEntry(entryId)
    if (!entry || entry.game !== game) throw new DomainError('NOT_FOUND', 'Record not found')
    const at = new Date(now).toISOString()
    const updated = await this.store.updateEntry(
      entry.id,
      expectedUpdatedAt,
      entryReviewChanges[action](entry, input, at),
    )
    if (!updated) throw new DomainError('CONFLICT', 'The record changed after it was loaded')
    await this.followUpEntryReview(action, entry, input, at)
    return { entry: updated, rank: await this.store.rankOf(updated) }
  }

  /** Closing the reports a resolution decided, and blocking a taken-down link when the admin asks. */
  async followUpEntryReview(
    action: EntryReviewAction,
    entry: LeaderboardEntry,
    input: Record<string, unknown>,
    now: string,
  ): Promise<void> {
    if (action === 'report-resolution') {
      const { target, resolution } = parseReportResolution(input)
      await this.store.resolveReports(entry.id, target, resolution, now)
    }
    if (action === 'takedown' && input.blockLinkedIn === true && entry.linkedIn) {
      await this.store.blockLink(await linkBlockHash(profileIdOf(entry.linkedIn.profileUrl)), now)
    }
  }

  /**
   * Accepts a held run as if it had scored, from the visitor's record as the admin read it (`updatedAt`, or `null` when
   * there was none). A past season's run only until a week after it ended; then that board stays as it is.
   */
  async acceptHeldRun(
    actor: Actor,
    game: string,
    runId: string,
    input: Record<string, unknown>,
    now = Date.now(),
  ): Promise<{ run: GameRun; entry: LeaderboardEntry }> {
    assertAdmin(actor)
    assertRankedGame(game)
    const expectedUpdatedAt = input.updatedAt === null ? null : versionInput(input.updatedAt, 'updatedAt')
    const run = await this.heldRun(game, runId)
    if (now >= acceptanceDeadline(run.season)) throw new DomainError('CONFLICT', "That season's board is final")
    const settle = await this.settlementFor(run, heldRunCandidate(run, crypto.randomUUID()))
    const accepted = await this.store.acceptRun(
      run.id,
      new Date(now).toISOString(),
      fromVersion(settle, expectedUpdatedAt),
    )
    if (!accepted) throw new DomainError('CONFLICT', 'The run was reviewed meanwhile')
    return { run: accepted.run, entry: accepted.settlement.entry }
  }

  /** Dismisses a held run: it stays stored as evidence and leaves the queue. */
  async rejectHeldRun(actor: Actor, game: string, runId: string, now = Date.now()): Promise<GameRun> {
    assertAdmin(actor)
    assertRankedGame(game)
    const run = await this.heldRun(game, runId)
    const rejected = await this.store.rejectRun(run.id, new Date(now).toISOString())
    if (!rejected) throw new DomainError('CONFLICT', 'The run was reviewed meanwhile')
    return rejected
  }

  /** Dismisses the held runs of visitors with no history on the season's board, a flood's usual shape. */
  async rejectRunsWithoutHistory(actor: Actor, game: string, input: Record<string, unknown>, now = Date.now()) {
    assertAdmin(actor)
    assertRankedGame(game)
    if (input.scope !== 'no-history') throw new DomainError('INVALID_INPUT', 'scope must be no-history')
    const board = { game, season: boardSeason(input.season ?? null, rankingMonth(now)) }
    const [runs, counts] = await Promise.all([
      this.store.listRunsForReview(board),
      this.store.countRunsByVisitor(board),
    ])
    const newVisitors = new Set(counts.filter(isNewVisitor).map(({ visitorHash }) => visitorHash))
    const reviewedAt = new Date(now).toISOString()
    const dismissed = await Promise.all(
      runs.filter((run) => newVisitors.has(run.visitorHash)).map((run) => this.store.rejectRun(run.id, reviewedAt)),
    )
    return { season: board.season, rejected: dismissed.filter((run) => run !== null).length }
  }

  /** A held run nobody has reviewed; any other run is `409`, and another game's is not found. */
  async heldRun(game: string, runId: string): Promise<GameRun> {
    const run = await this.store.getRun(runId)
    if (!run || run.game !== game) throw new DomainError('NOT_FOUND', 'Run not found')
    if (run.status !== 'flagged' || run.reviewedAt !== null)
      throw new DomainError('CONFLICT', 'The run is not waiting for review')
    return run
  }

  /** `entry` is the record the run just settled, if it did; otherwise the visitor's record is read as it stands now. */
  async runOutcome(run: GameRun, entry: LeaderboardEntry | null, consentNeeded: boolean): Promise<RunOutcome> {
    const record = entry ?? (await this.store.getBoardEntryByVisitor(run, run.visitorHash))
    const rank = record ? await this.store.rankOf(record) : 0
    return { run, entry: record, rank, standing: runStanding(run, record, rank, consentNeeded) }
  }
}
