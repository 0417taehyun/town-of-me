import { adminEmailAlreadyListed, adminEmailNotListed, lastAdminEmail, type AdminEmail } from './admins.js'
import type { Actor, LinkedUser } from './domain.js'
import { DomainError } from './domain.js'
import type { AuthStore, AuthTransaction, VerifiedLinkedInIdentity } from './auth.js'
import type { GuestbookEntry, GuestbookStatus } from './guestbook.js'
import {
  boardOrder,
  isPublicEntry,
  textOrder,
  type BoardKey,
  type EntryChanges,
  type EntrySettlement,
  type FinishedRun,
  type GameRun,
  type LeaderboardEntry,
  type SettleEntry,
} from './leaderboard.js'
import type { EntryReport, ReportResolution, ReportTarget, VisitorRunCounts } from './leaderboardReview.js'
import type { GameWeekCount, GuestbookDayCount, SiteEventCount } from './siteStats.js'
import { rankingDay, type TownLayout, type TownLayoutInput } from './town.js'

export interface Store extends AuthStore {
  getUser(id: string): Promise<LinkedUser | null>
  /** The deployment's one town; `null` until it is seeded or the admin saves it for the first time. */
  getTown(): Promise<TownLayout | null>
  /**
   * Replaces the whole layout and increments its revision, but only while `baseRevision` is still current
   * (0 for a town that was never saved); otherwise rejects with CONFLICT and keeps the stored layout.
   */
  saveTown(layout: TownLayoutInput, baseRevision: number): Promise<TownLayout>
  insertGuestbookEntry(entry: GuestbookEntry): Promise<void>
  /** Newest first; every status when `status` is omitted. */
  listGuestbookEntries(options: { status?: GuestbookStatus; limit: number }): Promise<GuestbookEntry[]>
  getGuestbookEntry(id: string): Promise<GuestbookEntry | null>
  getLatestGuestbookEntryByVisitor(visitorHash: string): Promise<GuestbookEntry | null>
  /** Applies `changes` only while the entry is still at `expectedUpdatedAt`; `null` if it is missing or changed. */
  updateGuestbookEntry(
    id: string,
    expectedUpdatedAt: string,
    changes: GuestbookEntryChanges,
  ): Promise<GuestbookEntry | null>
  deleteGuestbookEntry(id: string): Promise<void>
  /** Fills the admin list only while it is empty, so `ADMIN_EMAILS` never re-adds a removed email; `true` if it did. */
  seedAdminEmails(emails: readonly string[]): Promise<boolean>
  /** Sorted by email in code-point order, whatever the database collation. */
  listAdminEmails(): Promise<AdminEmail[]>
  /** Rejects with CONFLICT when the email is already listed. */
  addAdminEmail(email: string): Promise<AdminEmail>
  /**
   * Removes the email, demotes every user with it to `member`, and deletes their sessions in one step. Rejects
   * with NOT_FOUND when it is not listed and CONFLICT when it is the last one, so someone can always sign in as admin.
   */
  removeAdminEmail(email: string): Promise<void>
  /** Abandons the visitor's open run of the same game, if any, and stores `run`, in one step. Runs are never counted. */
  issueRun(run: GameRun): Promise<void>
  getRun(id: string): Promise<GameRun | null>
  /**
   * Finishes the run only while it is still `issued`, the visitor's, and unexpired at `finished.submittedAt`; for a
   * scored run, `settle` decides the visitor's record on the run's board within the same step. `null`, with nothing
   * changed, when the run cannot be finished, so a run is recorded once however many results arrive together.
   */
  finishRun(
    id: string,
    visitorHash: string,
    finished: FinishedRun,
    settle: SettleEntry | null,
  ): Promise<{ run: GameRun; settlement: EntrySettlement | null } | null>
  getBoardEntryByVisitor(board: BoardKey, visitorHash: string): Promise<LeaderboardEntry | null>
  /** 1 + the records ahead of `entry` in its board's public order: for an unlisted record, the place it would take. */
  rankOf(entry: LeaderboardEntry): Promise<number>
  /**
   * The top of the board's public order (listed and not disqualified), every record at its place. What of it anyone
   * may see is decided by `publishedPlaces`, which leaves out a statue's place still waiting for approval.
   */
  listBoard(board: BoardKey, limit: number): Promise<LeaderboardEntry[]>
  /**
   * Applies `changes` only while the record is still at `expectedUpdatedAt`; `null` if it is missing or changed. A record
   * taken down also takes the name and look off its visitor's runs on that board, in the same step.
   */
  updateEntry(id: string, expectedUpdatedAt: string, changes: EntryChanges): Promise<LeaderboardEntry | null>
  getEntry(id: string): Promise<LeaderboardEntry | null>
  /** Every record on the board, listed or not, in public order. */
  listEntries(board: BoardKey): Promise<LeaderboardEntry[]>
  /** The seasons before `currentSeason` with any record of the game, listed or not, newest first. */
  listEndedSeasons(game: string, currentSeason: string): Promise<string[]>
  /** The board's held runs nobody has reviewed yet. */
  listRunsForReview(board: BoardKey): Promise<GameRun[]>
  /** Per visitor with a run for the board: how many they started, abandoned, and had held. */
  countRunsByVisitor(board: BoardKey): Promise<VisitorRunCounts[]>
  /**
   * Whether the server judged a run of the game by the visitor: one it scored or held. A run rejected as too fast
   * does not count, since sending one takes no play.
   */
  hasJudgedRun(game: string, visitorHash: string): Promise<boolean>
  /**
   * Accepts a held run nobody has reviewed: it becomes `scored`, its profile goes, since the record now holds what may be
   * kept, and `settle` decides the visitor's record, in one step; if `settle` throws, nothing changes. `null`, with
   * nothing changed, when the run is no longer waiting for review.
   */
  acceptRun(
    id: string,
    reviewedAt: string,
    settle: SettleEntry,
  ): Promise<{ run: GameRun; settlement: EntrySettlement } | null>
  /** Marks a held run nobody has reviewed as reviewed, still held as evidence; `null` when it is not waiting. */
  rejectRun(id: string, reviewedAt: string): Promise<GameRun | null>
  /** `rejectRun` for those of `ids` that are the game's and still waiting, in one step; answers how many they were. */
  rejectRuns(game: string, ids: readonly string[], reviewedAt: string): Promise<number>
  addReport(report: EntryReport): Promise<void>
  /** Every report on the board's records, open or resolved, oldest first. */
  listReports(board: BoardKey): Promise<EntryReport[]>
  /** Resolves the record's open reports on `target`. */
  resolveReports(entryId: string, target: ReportTarget, resolution: ReportResolution, resolvedAt: string): Promise<void>
  isLinkBlocked(profileHash: string): Promise<boolean>
  /** Blocks the profile once; blocking it again changes nothing. */
  blockLink(profileHash: string, createdAt: string): Promise<void>
  /** Deletes the visitor's runs and records of the game in every season, with the reports on those records. */
  eraseVisitorGameData(game: string, visitorHash: string): Promise<void>
  /** Adds one to the day's total in one atomic step, so increments at the same moment never lose a count. */
  addSiteEvent(day: string, event: string, subject: string): Promise<void>
  /** The totals from `fromDay` to `toDay`, both KST days and both included, by day, event, and subject. */
  listSiteEventCounts(fromDay: string, toDay: string): Promise<SiteEventCount[]>
  /** The notes written from `fromDay` to `toDay`, both KST days and both included, by day and status. */
  countGuestbookEntriesByDay(fromDay: string, toDay: string): Promise<GuestbookDayCount[]>
  /** Each season of the game with any run or record, newest first. */
  countGameWeeks(game: string): Promise<GameWeekCount[]>
}

export type GuestbookEntryChanges = Partial<
  Pick<GuestbookEntry, 'appearance' | 'message' | 'locale' | 'status' | 'updatedAt'>
>

interface SessionRow {
  userId: string
  expiresAt: number
}

export class MemoryStore implements Store {
  readonly users = new Map<string, LinkedUser>()
  private town: TownLayout | null = null
  readonly guestbookEntries = new Map<string, GuestbookEntry>()
  readonly transactions = new Map<string, AuthTransaction>()
  readonly sessions = new Map<string, SessionRow>()
  readonly adminEmails = new Map<string, AdminEmail>()
  readonly gameRuns = new Map<string, GameRun>()
  readonly leaderboardEntries = new Map<string, LeaderboardEntry>()
  readonly entryReports = new Map<string, EntryReport>()
  readonly linkBlocks = new Map<string, string>()
  readonly siteEventCounts = new Map<string, SiteEventCount>()

  async saveTransaction(transaction: AuthTransaction): Promise<void> {
    this.transactions.set(transaction.id, transaction)
  }

  async consumeTransaction(id: string): Promise<AuthTransaction | null> {
    const transaction = this.transactions.get(id) ?? null
    this.transactions.delete(id)
    return transaction
  }

  async upsertLinkedUser(identity: VerifiedLinkedInIdentity): Promise<LinkedUser> {
    const existing = [...this.users.values()].find(
      (user) => user.oidcIssuer === identity.issuer && user.oidcSubject === identity.subject,
    )
    if (existing) {
      const updated = {
        ...existing,
        displayName: identity.displayName,
        email: identity.email,
        pictureUrl: identity.pictureUrl,
      }
      this.users.set(updated.id, updated)
      return updated
    }
    const user: LinkedUser = {
      id: crypto.randomUUID(),
      oidcIssuer: identity.issuer,
      oidcSubject: identity.subject,
      displayName: identity.displayName,
      email: identity.email,
      pictureUrl: identity.pictureUrl,
      role: 'member',
      createdAt: new Date().toISOString(),
      deletedAt: null,
    }
    this.users.set(user.id, user)
    return user
  }

  async saveSession(tokenHash: string, userId: string, expiresAt: number): Promise<void> {
    this.sessions.set(tokenHash, { userId, expiresAt })
  }

  async resolveSession(tokenHash: string, now: number): Promise<Actor | null> {
    const session = this.sessions.get(tokenHash)
    if (!session || session.expiresAt < now) return null
    const user = this.users.get(session.userId)
    if (!user || user.deletedAt) return null
    return { kind: 'linked', userId: user.id, role: user.role }
  }

  async deleteSession(tokenHash: string): Promise<void> {
    this.sessions.delete(tokenHash)
  }

  async assignRoleByEmail(userId: string, verifiedEmail: string | null): Promise<LinkedUser> {
    const user = this.users.get(userId)
    if (!user) throw new DomainError('NOT_FOUND', 'User not found')
    const role = verifiedEmail !== null && this.adminEmails.has(verifiedEmail) ? 'admin' : 'member'
    const assigned: LinkedUser = { ...user, role }
    this.users.set(userId, assigned)
    return assigned
  }

  async deleteExpiredSessionsAndTransactions(now: number): Promise<void> {
    deleteExpiredRecords(this.transactions, now)
    deleteExpiredRecords(this.sessions, now)
  }

  async getUser(id: string): Promise<LinkedUser | null> {
    return this.users.get(id) ?? null
  }

  async getTown(): Promise<TownLayout | null> {
    return structuredClone(this.town)
  }

  async saveTown(layout: TownLayoutInput, baseRevision: number): Promise<TownLayout> {
    const currentRevision = this.town?.revision ?? 0
    if (currentRevision !== baseRevision) throw new DomainError('CONFLICT', 'The town changed since it was loaded')
    const town: TownLayout = {
      ...structuredClone(layout),
      revision: currentRevision + 1,
      updatedAt: new Date().toISOString(),
    }
    this.town = town
    return structuredClone(town)
  }

  async insertGuestbookEntry(entry: GuestbookEntry): Promise<void> {
    this.guestbookEntries.set(entry.id, entry)
  }

  async listGuestbookEntries(options: { status?: GuestbookStatus; limit: number }): Promise<GuestbookEntry[]> {
    return newestFirst([...this.guestbookEntries.values()])
      .filter((entry) => !options.status || entry.status === options.status)
      .slice(0, options.limit)
  }

  async getGuestbookEntry(id: string): Promise<GuestbookEntry | null> {
    return this.guestbookEntries.get(id) ?? null
  }

  async getLatestGuestbookEntryByVisitor(visitorHash: string): Promise<GuestbookEntry | null> {
    const entries = [...this.guestbookEntries.values()].filter((entry) => entry.visitorHash === visitorHash)
    return newestFirst(entries)[0] ?? null
  }

  async updateGuestbookEntry(
    id: string,
    expectedUpdatedAt: string,
    changes: GuestbookEntryChanges,
  ): Promise<GuestbookEntry | null> {
    const entry = this.guestbookEntries.get(id)
    if (entry?.updatedAt !== expectedUpdatedAt) return null
    const updated = { ...entry, ...changes }
    this.guestbookEntries.set(id, updated)
    return updated
  }

  async deleteGuestbookEntry(id: string): Promise<void> {
    this.guestbookEntries.delete(id)
  }

  async seedAdminEmails(emails: readonly string[]): Promise<boolean> {
    if (this.adminEmails.size > 0 || emails.length === 0) return false
    const createdAt = new Date().toISOString()
    emails.forEach((email) => this.adminEmails.set(email, { email, createdAt }))
    return true
  }

  async listAdminEmails(): Promise<AdminEmail[]> {
    return [...this.adminEmails.values()].sort((left, right) => (left.email < right.email ? -1 : 1))
  }

  async addAdminEmail(email: string): Promise<AdminEmail> {
    if (this.adminEmails.has(email)) throw adminEmailAlreadyListed()
    const admin = { email, createdAt: new Date().toISOString() }
    this.adminEmails.set(email, admin)
    return admin
  }

  async removeAdminEmail(email: string): Promise<void> {
    if (!this.adminEmails.has(email)) throw adminEmailNotListed()
    if (this.adminEmails.size === 1) throw lastAdminEmail()
    this.adminEmails.delete(email)
    const demoted = [...this.users.values()].filter((user) => user.email?.trim().toLowerCase() === email)
    demoted.forEach((user) => this.users.set(user.id, { ...user, role: 'member' }))
    const demotedIds = new Set(demoted.map(({ id }) => id))
    const revoked = [...this.sessions].filter(([, session]) => demotedIds.has(session.userId)).map(([hash]) => hash)
    revoked.forEach((tokenHash) => this.sessions.delete(tokenHash))
  }

  async issueRun(run: GameRun): Promise<void> {
    const open = [...this.gameRuns.values()].filter(
      (other) => other.game === run.game && other.visitorHash === run.visitorHash && other.status === 'issued',
    )
    open.forEach((other) => this.gameRuns.set(other.id, { ...other, status: 'abandoned' }))
    this.gameRuns.set(run.id, structuredClone(run))
  }

  async getRun(id: string): Promise<GameRun | null> {
    const run = this.gameRuns.get(id)
    return run ? structuredClone(run) : null
  }

  // Nothing is awaited between the check and the writes, so this is one step like the PostgreSQL transaction.
  async finishRun(
    id: string,
    visitorHash: string,
    finished: FinishedRun,
    settle: SettleEntry | null,
  ): Promise<{ run: GameRun; settlement: EntrySettlement | null } | null> {
    const run = this.gameRuns.get(id)
    if (run?.status !== 'issued' || run.visitorHash !== visitorHash) return null
    if (Date.parse(run.expiresAt) <= Date.parse(finished.submittedAt)) return null
    const done: GameRun = { ...run, ...structuredClone(finished) }
    this.gameRuns.set(id, done)
    const settlement = settle ? this.settleEntry(done, settle) : null
    return { run: structuredClone(done), settlement }
  }

  settleEntry(run: GameRun, settle: SettleEntry): EntrySettlement {
    const entries = [...this.leaderboardEntries.values()]
    const current = findBoardEntry(entries, run, run.visitorHash)
    const settlement = settle(current, current ? null : findLatestEntry(entries, run.game, run.visitorHash))
    if (settlement.changed) this.leaderboardEntries.set(settlement.entry.id, structuredClone(settlement.entry))
    return structuredClone(settlement)
  }

  async getBoardEntryByVisitor(board: BoardKey, visitorHash: string): Promise<LeaderboardEntry | null> {
    return findBoardEntry([...this.leaderboardEntries.values()], board, visitorHash)
  }

  async rankOf(entry: LeaderboardEntry): Promise<number> {
    const ahead = [...this.leaderboardEntries.values()].filter(
      (other) => isOnBoard(other, entry) && isPublicEntry(other) && boardOrder(other, entry) < 0,
    )
    return ahead.length + 1
  }

  async listBoard(board: BoardKey, limit: number): Promise<LeaderboardEntry[]> {
    const listed = [...this.leaderboardEntries.values()].filter(
      (entry) => isOnBoard(entry, board) && isPublicEntry(entry),
    )
    return structuredClone(listed.sort(boardOrder).slice(0, limit))
  }

  async updateEntry(id: string, expectedUpdatedAt: string, changes: EntryChanges): Promise<LeaderboardEntry | null> {
    const entry = this.leaderboardEntries.get(id)
    if (entry?.updatedAt !== expectedUpdatedAt) return null
    const updated = { ...entry, ...structuredClone(changes) }
    this.leaderboardEntries.set(id, updated)
    if (updated.takedown) this.forgetRunProfiles(updated)
    return structuredClone(updated)
  }

  forgetRunProfiles(entry: LeaderboardEntry): void {
    const runs = [...this.gameRuns.values()].filter(
      (run) => isOnBoard(run, entry) && run.visitorHash === entry.visitorHash,
    )
    runs.forEach((run) => this.gameRuns.set(run.id, { ...run, profile: null }))
  }

  async getEntry(id: string): Promise<LeaderboardEntry | null> {
    const entry = this.leaderboardEntries.get(id)
    return entry ? structuredClone(entry) : null
  }

  async listEntries(board: BoardKey): Promise<LeaderboardEntry[]> {
    const entries = [...this.leaderboardEntries.values()].filter((entry) => isOnBoard(entry, board))
    return structuredClone(entries.sort(boardOrder))
  }

  async listEndedSeasons(game: string, currentSeason: string): Promise<string[]> {
    const ended = [...this.leaderboardEntries.values()].filter(
      (entry) => entry.game === game && entry.season < currentSeason,
    )
    return [...new Set(ended.map(({ season }) => season))].sort().reverse()
  }

  async listRunsForReview(board: BoardKey): Promise<GameRun[]> {
    const held = [...this.gameRuns.values()].filter(
      (run) => isOnBoard(run, board) && run.status === 'flagged' && run.reviewedAt === null,
    )
    return structuredClone(held)
  }

  async countRunsByVisitor(board: BoardKey): Promise<VisitorRunCounts[]> {
    const counts = new Map<string, VisitorRunCounts>()
    const runs = [...this.gameRuns.values()].filter((run) => isOnBoard(run, board))
    runs.forEach((run) => counts.set(run.visitorHash, countedRun(counts.get(run.visitorHash), run)))
    return [...counts.values()]
  }

  async hasJudgedRun(game: string, visitorHash: string): Promise<boolean> {
    return [...this.gameRuns.values()].some(
      (run) =>
        run.game === game && run.visitorHash === visitorHash && (run.status === 'scored' || run.status === 'flagged'),
    )
  }

  // `settle` runs before anything is written, so a refusal changes nothing, like the PostgreSQL rollback.
  async acceptRun(
    id: string,
    reviewedAt: string,
    settle: SettleEntry,
  ): Promise<{ run: GameRun; settlement: EntrySettlement } | null> {
    const run = this.gameRuns.get(id)
    if (run?.status !== 'flagged' || run.reviewedAt !== null) return null
    const settlement = this.settleEntry(run, settle)
    const accepted: GameRun = { ...run, status: 'scored', reviewedAt, profile: null }
    this.gameRuns.set(id, accepted)
    return { run: structuredClone(accepted), settlement }
  }

  async rejectRun(id: string, reviewedAt: string): Promise<GameRun | null> {
    const run = this.gameRuns.get(id)
    if (run?.status !== 'flagged' || run.reviewedAt !== null) return null
    const rejected = { ...run, reviewedAt }
    this.gameRuns.set(id, rejected)
    return structuredClone(rejected)
  }

  async rejectRuns(game: string, ids: readonly string[], reviewedAt: string): Promise<number> {
    const listed = new Set(ids)
    const waiting = [...this.gameRuns.values()].filter(
      (run) => listed.has(run.id) && run.game === game && run.status === 'flagged' && run.reviewedAt === null,
    )
    waiting.forEach((run) => this.gameRuns.set(run.id, { ...run, reviewedAt }))
    return waiting.length
  }

  async addReport(report: EntryReport): Promise<void> {
    this.entryReports.set(report.id, structuredClone(report))
  }

  async listReports(board: BoardKey): Promise<EntryReport[]> {
    const onBoard = new Set(
      [...this.leaderboardEntries.values()].filter((entry) => isOnBoard(entry, board)).map(({ id }) => id),
    )
    const reports = [...this.entryReports.values()].filter((report) => onBoard.has(report.entryId))
    return structuredClone(reports.sort((left, right) => textOrder(left.createdAt, right.createdAt)))
  }

  async resolveReports(
    entryId: string,
    target: ReportTarget,
    resolution: ReportResolution,
    resolvedAt: string,
  ): Promise<void> {
    const open = [...this.entryReports.values()].filter(
      (report) => report.entryId === entryId && report.target === target && report.resolvedAt === null,
    )
    open.forEach((report) => this.entryReports.set(report.id, { ...report, resolvedAt, resolution }))
  }

  async isLinkBlocked(profileHash: string): Promise<boolean> {
    return this.linkBlocks.has(profileHash)
  }

  async blockLink(profileHash: string, createdAt: string): Promise<void> {
    this.linkBlocks.set(profileHash, this.linkBlocks.get(profileHash) ?? createdAt)
  }

  async eraseVisitorGameData(game: string, visitorHash: string): Promise<void> {
    const isTheirs = (item: { game: string; visitorHash: string }) =>
      item.game === game && item.visitorHash === visitorHash
    const entryIds = new Set([...this.leaderboardEntries.values()].filter(isTheirs).map(({ id }) => id))
    const reportIds = [...this.entryReports.values()]
      .filter((report) => entryIds.has(report.entryId))
      .map(({ id }) => id)
    const runIds = [...this.gameRuns.values()].filter(isTheirs).map(({ id }) => id)
    reportIds.forEach((id) => this.entryReports.delete(id))
    entryIds.forEach((id) => this.leaderboardEntries.delete(id))
    runIds.forEach((id) => this.gameRuns.delete(id))
  }

  // Nothing is awaited between the read and the write, so this is one step like the PostgreSQL upsert.
  async addSiteEvent(day: string, event: string, subject: string): Promise<void> {
    const key = JSON.stringify([day, event, subject])
    const count = (this.siteEventCounts.get(key)?.count ?? 0) + 1
    this.siteEventCounts.set(key, { day, event, subject, count })
  }

  async listSiteEventCounts(fromDay: string, toDay: string): Promise<SiteEventCount[]> {
    const counts = [...this.siteEventCounts.values()].filter(({ day }) => day >= fromDay && day <= toDay)
    return structuredClone(counts)
  }

  async countGuestbookEntriesByDay(fromDay: string, toDay: string): Promise<GuestbookDayCount[]> {
    const counts = new Map<string, GuestbookDayCount>()
    const written = [...this.guestbookEntries.values()].map((entry) => ({ ...entry, day: rankingDay(entry.createdAt) }))
    written
      .filter(({ day }) => day >= fromDay && day <= toDay)
      .forEach(({ day, status }) => {
        const key = `${day}:${status}`
        counts.set(key, { day, status, count: (counts.get(key)?.count ?? 0) + 1 })
      })
    return [...counts.values()]
  }

  async countGameWeeks(game: string): Promise<GameWeekCount[]> {
    const weeks = new Map<string, GameWeekCount>()
    const count = (season: string, field: 'runs' | 'records') => {
      const week = weeks.get(season) ?? { week: season, runs: 0, records: 0 }
      weeks.set(season, { ...week, [field]: week[field] + 1 })
    }
    const isGame = (item: { game: string }) => item.game === game
    const runs = [...this.gameRuns.values()].filter(isGame)
    const records = [...this.leaderboardEntries.values()].filter(isGame)
    runs.forEach(({ season }) => count(season, 'runs'))
    records.forEach(({ season }) => count(season, 'records'))
    return [...weeks.values()].sort((left, right) => textOrder(right.week, left.week))
  }
}

/** `counted` with `run` added. */
export function countedRun(counted: VisitorRunCounts | undefined, run: GameRun): VisitorRunCounts {
  const counts = counted ?? { visitorHash: run.visitorHash, runs: 0, abandoned: 0, flagged: 0 }
  return {
    visitorHash: counts.visitorHash,
    runs: counts.runs + 1,
    abandoned: counts.abandoned + Number(run.status === 'abandoned'),
    flagged: counts.flagged + Number(run.status === 'flagged'),
  }
}

/** Whether a record or run belongs to the board. */
export function isOnBoard(item: BoardKey, board: BoardKey): boolean {
  return item.game === board.game && item.season === board.season
}

export function findBoardEntry(
  entries: readonly LeaderboardEntry[],
  board: BoardKey,
  visitorHash: string,
): LeaderboardEntry | null {
  const entry = entries.find((candidate) => isOnBoard(candidate, board) && candidate.visitorHash === visitorHash)
  return entry ? structuredClone(entry) : null
}

/** The visitor's record of the game from the latest season. */
export function findLatestEntry(
  entries: readonly LeaderboardEntry[],
  game: string,
  visitorHash: string,
): LeaderboardEntry | null {
  const own = entries.filter((entry) => entry.game === game && entry.visitorHash === visitorHash)
  const latest = own.sort((left, right) => (left.season < right.season ? 1 : -1))[0]
  return latest ? structuredClone(latest) : null
}

export function deleteExpiredRecords(records: Map<string, { expiresAt: number }>, now: number): void {
  const expiredKeys = [...records].filter(([, record]) => record.expiresAt < now).map(([key]) => key)
  expiredKeys.forEach((key) => records.delete(key))
}

export function newestFirst(entries: GuestbookEntry[]): GuestbookEntry[] {
  return entries.sort((left, right) => right.createdAt.localeCompare(left.createdAt) || right.id.localeCompare(left.id))
}
