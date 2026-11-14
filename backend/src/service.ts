import { adminEmail, type AdminEmail } from './admins.js'
import type { Actor, LinkedUser } from './domain.js'
import { DomainError } from './domain.js'
import { guestbookEntryNotFound, isRevisable, parseGuestbookInput, type GuestbookEntry } from './guestbook.js'
import {
  assertRankedGame,
  derbyRunFlags,
  judgeDerbyRun,
  minimumRunMs,
  notFromBrowserFlag,
  parseDerbySubmission,
  homeRunDerby,
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
  podiumPlaceFlag,
  publishedPlaces,
  randomRunSeed,
  runLifetimeMs,
  runStanding,
  settleBoardEntry,
  statueCount,
  wouldTakePodium,
  type BoardCandidate,
  type BoardKey,
  type BoardPlace,
  type EntryChanges,
  type FinishedRun,
  type GameRun,
  type LeaderboardEntry,
  type NameStatus,
  type RankedRecord,
  type RunStanding,
  type SettleEntry,
} from './leaderboard.js'
import {
  isTownProfile,
  leaderboardNameStatus,
  linkBlockHash,
  ownershipCode,
  profileIdOf,
  reservedNameForms,
  takenNameForms,
  type LinkedInLink,
} from './leaderboardIdentity.js'
import {
  acceptanceDeadline,
  entryReviewChanges,
  forgetQuietReporters,
  fromVersion,
  heldRunCandidate,
  listableAfterSeason,
  overlapWarnings,
  parseEntryReport,
  parseRecordIds,
  parseReportResolution,
  parseRunIds,
  recentReports,
  reportedChanges,
  reportsPerHour,
  reportSweepIntervalMs,
  reviewedBoard,
  reviewQueue,
  versionInput,
  type EntryReviewAction,
  type ReviewBoard,
} from './leaderboardReview.js'
import { assertAdmin } from './policy.js'
import {
  dailyEventTotals,
  guestbookTotals,
  isTownResident,
  parseSiteEvent,
  parseStatsDays,
  residentTalkEvent,
  residentTotals,
  statsRange,
  weeksInRange,
} from './siteStats.js'
import type { Store } from './store.js'
import {
  effectiveBallparkRules,
  parseResidentDialogueSource,
  parseTownLayout,
  previousRankingWeek,
  rankingDay,
  rankingWeek,
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

/** A board's top places as anyone may see them (`publishedPlaces`), and the visitor's own record with its place. */
export interface Leaderboard {
  season: string
  currentSeason: string
  entries: RankedRecord[]
  own: RankedRecord | null
}

/** The statues of one season as anyone may see them: a place still waiting for approval is missing. */
export interface SeasonStatues {
  season: string
  entries: RankedRecord[]
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

  async getTown(): Promise<TownLayout> {
    const town = await this.store.getTown()
    if (!town) throw new DomainError('NOT_FOUND', 'Town not found')
    return town
  }

  /**
   * Replaces the whole town; the editor sends the revision it loaded so a stale tab cannot overwrite newer work. The
   * ballpark rules in effect are settled against the stored town for the KST week of `now`. `now` is taken when the
   * request arrives, so a save that commits in the first moment of a week may still settle against the week before;
   * that window is accepted.
   */
  async saveTown(actor: Actor, input: Record<string, unknown>, now = Date.now()): Promise<TownLayout> {
    assertAdmin(actor)
    const baseRevision = input.baseRevision
    if (typeof baseRevision !== 'number' || !Number.isInteger(baseRevision) || baseRevision < 0) {
      throw new DomainError('INVALID_INPUT', 'baseRevision must be a non-negative integer')
    }
    const layout = parseTownLayout(input)
    const stored = await this.store.getTown()
    // A stale tab hears CONFLICT before its schedule is compared with newer work. A save that lands after this read
    // still moves the revision, so the store refuses this one rather than overwrite it.
    if ((stored?.revision ?? 0) !== baseRevision) {
      throw new DomainError('CONFLICT', 'The town changed since it was loaded')
    }
    const ballpark = settleBallparkSettings(layout.venues.ballpark, stored?.venues.ballpark ?? null, rankingWeek(now))
    return this.store.saveTown({ ...layout, venues: { ...layout.venues, ballpark } }, baseRevision)
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

  /** Adds one to today's total, or does nothing for anything but a listed event with a resident of the town. */
  async recordSiteEvent(input: Record<string, unknown> | null, now = Date.now()): Promise<void> {
    const counted = parseSiteEvent(input)
    if (!counted) return
    if (counted.event === residentTalkEvent && !isTownResident(await this.store.getTown(), counted.subject)) return
    await this.store.addSiteEvent(rankingDay(new Date(now).toISOString()), counted.event, counted.subject)
  }

  /** The totals of the last `days` KST days, and the game's seasons with a day among them. */
  async getSiteStats(actor: Actor, days: string | null, now = Date.now()) {
    assertAdmin(actor)
    const range = statsRange(parseStatsDays(days), now)
    const [events, notes, derby, town] = await Promise.all([
      this.store.listSiteEventCounts(range.from, range.to),
      this.store.countGuestbookEntriesByDay(range.from, range.to),
      this.store.countGameWeeks(homeRunDerby.id),
      this.store.getTown(),
    ])
    return {
      range,
      daily: dailyEventTotals(events),
      residents: residentTotals(events, town?.residents ?? []),
      guestbook: guestbookTotals(notes),
      derby: weeksInRange(derby, range),
    }
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
   * takes the rules in effect for the KST week of `now`, the season it counts in wherever its result arrives.
   */
  async issueRun(game: string, visitorHash: string, now = Date.now(), seed = randomRunSeed()): Promise<GameRun> {
    const town = await this.openBallparkTown(game)
    // A record is public, so a site without a contact for takedown requests ranks nothing.
    if (!town.owner.contactEmail) {
      throw new DomainError('NOT_CONFIGURED', "Ranked runs need the town owner's contact email")
    }
    const season = rankingWeek(now)
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
   * again gets the same answer; a run held for review leaves the visitor's record as it was. A run is held for what
   * the judge finds unusual, for a request that did not look like the game page's (`fromGamePage`, which is all that is
   * kept of the request), and for a place among the statues, which only an approved record takes. A malformed result
   * leaves the run open for a fixed client to send again, but one that ends too soon uses the run up.
   */
  async submitRunResult(
    game: string,
    visitorHash: string | null,
    runId: string,
    input: Record<string, unknown>,
    fromGamePage: boolean,
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
    if (serverElapsedMs < minimumRunMs(run.rules)) {
      return this.rejectTooFastRun(run, input, submittedAt, fromGamePage, now)
    }
    const submission = parseDerbySubmission(input, run.rules)
    const profile = parseRunProfile(input.profile)
    const record = judgeDerbyRun(run.rules, run.seed, submission, serverElapsedMs)
    const current = await this.store.getBoardEntryByVisitor(run, run.visitorHash)
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
    const place = {
      id: candidate.entryId,
      score: candidate.score,
      tiebreak: candidate.tiebreak,
      achievedAt: submittedAt,
    }
    const flags = [
      ...derbyRunFlags({ rules: run.rules, log: submission.log, record }),
      ...(fromGamePage ? [] : [notFromBrowserFlag]),
      ...(await this.podiumFlags(run, place, current)),
    ]
    const held = flags.length > 0
    // A held run keeps who it was sent as for its acceptance, unless a takedown already took that off this board.
    const keepsProfile = held && !current?.takedown
    const finished: FinishedRun = {
      status: held ? 'flagged' : 'scored',
      submittedAt,
      inputLog: submission.log,
      result: record,
      score: candidate.score,
      tiebreak: candidate.tiebreak,
      flags,
      profile: keepsProfile ? profile : null,
    }
    const settle = held ? null : await this.settlementFor(run, candidate)
    const saved = await this.store.finishRun(run.id, run.visitorHash, finished, settle)
    // Another result for this run, or a new run, got there first: answer as the run now stands.
    if (!saved) return this.submitRunResult(game, visitorHash, runId, input, fromGamePage, now)
    return this.runOutcome(saved.run, saved.settlement?.entry ?? null, saved.settlement?.consentNeeded ?? false)
  }

  /**
   * `podiumPlaceFlag` for a run that would be its visitor's best among the statues (`wouldTakePodium`), read from the
   * board as it stands. A record that reaches the statues some other way, or between this read and the write, is
   * still not shown there unapproved: `publishedPlaces` decides that on every read.
   */
  async podiumFlags(run: GameRun, place: BoardPlace, current: LeaderboardEntry | null): Promise<string[]> {
    const top = await this.store.listBoard(run, statueCount + 1)
    return wouldTakePodium(place, current, top, run.visitorHash) ? [podiumPlaceFlag] : []
  }

  /** The town whose ballpark plays `game`, while the admin shows it: a hidden ballpark neither issues nor records runs. */
  async openBallparkTown(game: string): Promise<TownLayout> {
    assertRankedGame(game)
    const town = await this.store.getTown()
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
    fromGamePage: boolean,
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
    if (!saved) return this.submitRunResult(run.game, run.visitorHash, run.id, input, fromGamePage, now)
    throw new DomainError('CONFLICT', 'The run ended sooner than its pitches can be played')
  }

  /**
   * A season's board, this KST week's by default, kept with no end date. A season still to come has none. Reads stay
   * open while the ballpark is hidden: the frontend decides what a hidden venue shows.
   */
  async getLeaderboard(
    game: string,
    visitorHash: string | null,
    requestedSeason: string | null,
    now = Date.now(),
  ): Promise<Leaderboard> {
    assertRankedGame(game)
    const currentSeason = rankingWeek(now)
    const season = boardSeason(requestedSeason, currentSeason)
    const board = { game, season }
    const own = visitorHash ? await this.store.getBoardEntryByVisitor(board, visitorHash) : null
    return {
      season,
      currentSeason,
      entries: await this.publishedBoard(board, leaderboardLength),
      own: own && { entry: own, rank: await this.store.rankOf(own) },
    }
  }

  /** The top of a board as anyone may see it: every public read of a board comes through here (`publishedPlaces`). */
  async publishedBoard(board: BoardKey, limit: number): Promise<RankedRecord[]> {
    return publishedPlaces(await this.store.listBoard(board, limit))
  }

  /** This KST week's statues: the approved of its public order's first three, read by the town without a cookie. */
  async getPodium(game: string, now = Date.now()): Promise<SeasonStatues> {
    assertRankedGame(game)
    const season = rankingWeek(now)
    return { season, entries: await this.publishedBoard({ game, season }, statueCount) }
  }

  /**
   * Every finished season with a record, newest first, and the approved of its public order's first three as they
   * stand now: a late acceptance, an approval, a disqualification, or an owner's change still moves them. One read per
   * season, so a year adds fifty-two.
   */
  async getHallOfFame(game: string, now = Date.now()): Promise<SeasonStatues[]> {
    assertRankedGame(game)
    const seasons = await this.store.listEndedSeasons(game, rankingWeek(now))
    return Promise.all(
      seasons.map(async (season) => ({ season, entries: await this.publishedBoard({ game, season }, statueCount) })),
    )
  }

  /**
   * The visitor lists or unlists this week's record, changes the character and name it shows, or turns its link on or
   * off. A past season's record (`season`) may only be anonymised or have its link turned off, unless its best run
   * came in after the season ended (`listableAfterSeason`): then it takes the same changes as this week's, and can
   * still be anonymised, which only a past record offers. Listing never publishes a place among the statues by
   * itself: that waits for the admin's approval (`publishedPlaces`).
   */
  async updateOwnEntry(
    game: string,
    visitorHash: string | null,
    input: Record<string, unknown>,
    requestedSeason: string | null = null,
    now = Date.now(),
  ): Promise<RankedRecord> {
    assertRankedGame(game)
    const currentSeason = rankingWeek(now)
    const board = { game, season: boardSeason(requestedSeason, currentSeason) }
    const at = new Date(now).toISOString()
    const entry = await this.ownEntryOn(board, visitorHash)
    const pastSeason = board.season < currentSeason
    if (pastSeason && (input.anonymize === true || !(await this.isListableLate(entry, now)))) {
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
    if (!entry) throw new DomainError('NOT_FOUND', 'No record that season')
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
    return { entry: updated, rank: await this.store.rankOf(updated) }
  }

  /** A link the town shows already, or one a takedown blocked, cannot be claimed. */
  async assertLinkAllowed(link: LinkedInLink): Promise<void> {
    const town = await this.store.getTown()
    if (isTownProfile(town, link.profileId) || (await this.store.isLinkBlocked(await linkBlockHash(link.profileId)))) {
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
    const [town, entries] = await Promise.all([this.store.getTown(), this.store.listEntries(board)])
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
   * nothing can be learned from it, and it counts only from a visitor with a run the server judged, about someone
   * else's record, at most five an hour: a record's owner cannot report their own link to fix it as restored. A report
   * only waits for the admin, so no visitor can blank the board; the one thing it hides at once is a link whose
   * profile's owner says it is theirs.
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
    if (!(await this.store.hasJudgedRun(game, visitorHash))) return
    this.reportTimes.set(visitorHash, [...recent, now])
    const at = new Date(now).toISOString()
    await this.store.addReport({
      id: crypto.randomUUID(),
      entryId: entry.id,
      ...report,
      createdAt: at,
      resolvedAt: null,
      resolution: null,
    })
    const hidden = reportedChanges(entry, report, ownershipCode(), at)
    // A record that changed meanwhile keeps its new version; the report still waits in the queue.
    if (hidden) await this.store.updateEntry(entry.id, entry.updatedAt, hidden)
  }

  /** Forgets the visitors with no report in the last hour, at most once a minute, so the counter cannot keep growing. */
  sweepReportTimes(now: number): void {
    if (now - this.reportTimesSweptAt < reportSweepIntervalMs) return
    forgetQuietReporters(this.reportTimes, now)
    this.reportTimesSweptAt = now
  }

  /**
   * The review queue of one season, or by default of this season, the last, and any older one with a statue's place
   * waiting for approval (`leaderboardReview.ts`).
   */
  async getReviewQueue(actor: Actor, game: string, requestedSeason: string | null, now = Date.now()) {
    assertAdmin(actor)
    assertRankedGame(game)
    const currentSeason = rankingWeek(now)
    const seasons =
      requestedSeason === null
        ? await this.seasonsToReview(game, currentSeason)
        : [boardSeason(requestedSeason, currentSeason)]
    const town = await this.store.getTown()
    const boards = await Promise.all(seasons.map((season) => this.reviewBoard({ game, season })))
    return reviewQueue(boards, { town, currentSeason, now })
  }

  /**
   * This season and the last, whose held runs may still be accepted, then every older season where a record among the
   * statues waits for approval: a record that moved up there leaves its place empty in the hall of fame until the
   * admin sees it, so it must not wait where nobody looks.
   */
  async seasonsToReview(game: string, currentSeason: string): Promise<string[]> {
    const lastSeason = previousRankingWeek(currentSeason)
    const older = await this.store.listEndedSeasons(game, lastSeason)
    const statues = await Promise.all(
      older.map(async (season) => ({ season, top: await this.store.listBoard({ game, season }, statueCount) })),
    )
    const waiting = statues.filter(({ top }) => publishedPlaces(top).length < top.length)
    return [currentSeason, lastSeason, ...waiting.map(({ season }) => season)]
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
   * Every record on one season's board, including those the queue does not list, as an admin's search reads them, and
   * the season that turned out to be. Warnings are read apart (`getRecordWarnings`).
   */
  async getBoardRecords(actor: Actor, game: string, requestedSeason: string | null, now = Date.now()) {
    assertAdmin(actor)
    assertRankedGame(game)
    const season = boardSeason(requestedSeason, rankingWeek(now))
    return { season, entries: reviewedBoard(await this.store.listEntries({ game, season })) }
  }

  /**
   * The warnings of the records a search found, by id: a record outside the queue must not be approved blind. Only for
   * those, since each compares against the whole board: at 3,000 records that takes 37 ms for twenty and 5.5 s of
   * blocked event loop for all of them, on every reload after an action.
   */
  async getRecordWarnings(actor: Actor, game: string, requestedSeason: string | null, ids: string, now = Date.now()) {
    assertAdmin(actor)
    assertRankedGame(game)
    const season = boardSeason(requestedSeason, rankingWeek(now))
    const wanted = new Set(parseRecordIds(ids))
    const [town, entries] = await Promise.all([this.store.getTown(), this.store.listEntries({ game, season })])
    const found = entries.filter((entry) => wanted.has(entry.id))
    return Object.fromEntries(found.map((entry) => [entry.id, overlapWarnings(entry, entries, town)]))
  }

  /** Any run of the game for an admin: a record's best run has scored, so it is not among the queue's held runs. */
  async getReviewedRun(actor: Actor, game: string, runId: string): Promise<GameRun> {
    assertAdmin(actor)
    assertRankedGame(game)
    return this.gameRun(game, runId)
  }

  /**
   * An admin's action on a record (`entryReviewChanges`), only from the version they read: a record changed since is
   * `409` and stays as it is. Approving a record publishes it at once, among the statues too; disqualifying a statue
   * moves the next record up, where it is published only if it is approved.
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
   * there was none), which it leaves approved, so it is published at once wherever it places. A past season's run only
   * until a week after it ended; then that board stays as it is.
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
    const record = await this.store.getBoardEntryByVisitor(run, run.visitorHash)
    const settle = await this.settlementFor(run, heldRunCandidate(run, crypto.randomUUID(), record))
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

  /**
   * Dismisses the held runs the admin listed, in one step, a flood's usual answer. Naming them means a run that arrived
   * after the list loaded stays waiting, since a dismissal cannot be undone; any no longer waiting are not counted.
   */
  async rejectListedRuns(actor: Actor, game: string, input: Record<string, unknown>, now = Date.now()) {
    assertAdmin(actor)
    assertRankedGame(game)
    const runIds = parseRunIds(input.runIds)
    return { rejected: await this.store.rejectRuns(game, runIds, new Date(now).toISOString()) }
  }

  /** A held run nobody has reviewed; any other run is `409`, and another game's is not found. */
  async heldRun(game: string, runId: string): Promise<GameRun> {
    const run = await this.gameRun(game, runId)
    if (run.status !== 'flagged' || run.reviewedAt !== null)
      throw new DomainError('CONFLICT', 'The run is not waiting for review')
    return run
  }

  async gameRun(game: string, runId: string): Promise<GameRun> {
    const run = await this.store.getRun(runId)
    if (!run || run.game !== game) throw new DomainError('NOT_FOUND', 'Run not found')
    return run
  }

  /** `entry` is the record the run just settled, if it did; otherwise the visitor's record is read as it stands now. */
  async runOutcome(run: GameRun, entry: LeaderboardEntry | null, consentNeeded: boolean): Promise<RunOutcome> {
    const record = entry ?? (await this.store.getBoardEntryByVisitor(run, run.visitorHash))
    const rank = record ? await this.store.rankOf(record) : 0
    return { run, entry: record, rank, standing: runStanding(run, record, rank, consentNeeded) }
  }
}
