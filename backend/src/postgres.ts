import { readdir, readFile } from 'node:fs/promises'
import type { Pool, PoolClient } from 'pg'
import { adminEmailAlreadyListed, adminEmailNotListed, lastAdminEmail, type AdminEmail } from './admins.js'
import { hashToken, type AuthTransaction, type VerifiedLinkedInIdentity } from './auth.js'
import type { CharacterAppearance } from './character.js'
import { DomainError, type Actor, type LinkedUser, type Locale, type LocalizedText } from './domain.js'
import type { DerbyInputLog } from './derbyJudge/derbyScore.js'
import type { GuestbookAppearance, GuestbookEntry, GuestbookStatus } from './guestbook.js'
import type { DerbyRunRecord, PublicDerbyResult } from './homeRunDerby.js'
import type {
  BoardKey,
  EntryChanges,
  EntrySettlement,
  FinishedRun,
  GameRun,
  LeaderboardEntry,
  LinkedInStatus,
  NameStatus,
  ReviewStatus,
  RunProfile,
  RunStatus,
  SettleEntry,
} from './leaderboard.js'
import type { EntryReport, ReportResolution, ReportTarget, VisitorRunCounts } from './leaderboardReview.js'
import type { GuestbookEntryChanges, Store } from './store.js'
import {
  type BallparkRules,
  parseTownVenues,
  type ResidentDialogue,
  type TownLayout,
  type TownLayoutInput,
  type TownObject,
  type TownMovement,
  type TownOwner,
  type TownPet,
  type TownPoint,
  type TownVector,
} from './town.js'

const migrationLockKey = 7_301_202_610
// The first key of the two-key advisory locks that serialize one visitor's runs and records (`lockVisitorGame`).
const visitorGameLockSpace = 7_301_203

type UserRow = {
  id: string
  oidc_issuer: string
  oidc_subject: string
  display_name: string
  email: string | null
  picture_url: string | null
  role: LinkedUser['role']
  created_at: Date
  deleted_at: Date | null
}

type GuestbookRow = {
  id: string
  visitor_hash: string
  author_appearance: GuestbookAppearance
  message: string
  locale: Locale
  status: GuestbookStatus
  created_at: Date
  updated_at: Date
}

type SessionActorRow = { user_id: string; role: LinkedUser['role'] }

type GameRunRow = {
  id: string
  game: string
  season: string
  visitor_hash: string
  // bigint, which node-postgres reads as text.
  seed: string
  rules: BallparkRules
  status: RunStatus
  issued_at: Date
  expires_at: Date
  submitted_at: Date | null
  input_log: DerbyInputLog | null
  result: DerbyRunRecord | null
  score: number | null
  tiebreak: number | null
  flags: string[]
  profile: RunProfile | null
  reviewed_at: Date | null
}

type LeaderboardEntryRow = {
  id: string
  game: string
  season: string
  visitor_hash: string
  best_run_id: string | null
  score: number
  tiebreak: number
  result: PublicDerbyResult
  achieved_at: Date
  author_name: string | null
  name_status: NameStatus | null
  author_appearance: CharacterAppearance
  appearance_public: boolean
  listed: boolean
  review_status: ReviewStatus
  linkedin_profile_url: string | null
  linkedin_status: LinkedInStatus | null
  linkedin_code: string | null
  takedown: boolean
  created_at: Date
  updated_at: Date
}

type EntryReportRow = {
  id: string
  entry_id: string
  target: ReportTarget
  reason: EntryReport['reason']
  created_at: Date
  resolved_at: Date | null
  resolution: ReportResolution | null
}

type VisitorRunCountsRow = { visitor_hash: string; runs: number; abandoned: number; flagged: number }

type TransactionRow = { state: string; nonce: string; expires_at: Date }

type AdminEmailRow = { email: string; created_at: Date }

type TownObjectProperties = Pick<
  TownObject,
  'variant' | 'seats' | 'points' | 'width' | 'ownerName' | 'description' | 'linkedInProfileUrl'
>

type TownObjectRow = {
  id: string
  type: string
  position_x: number
  position_y: number
  position_z: number
  rotation: number
  scale: number
  color: string | null
  properties: TownObjectProperties
}

type TownResidentRow = {
  id: string
  name: string
  appearance: CharacterAppearance
  route: TownPoint[]
  bench_object_id: string
  seat_index: number
  start_seated: boolean
  role: LocalizedText | null
  relationship: LocalizedText | null
  linkedin_profile_url: string | null
  reference: LocalizedText | null
  dialogue: ResidentDialogue | null
}

type TownRow = {
  id: string
  name: string
  // Rows saved before the introduction, contact email, owner's resident and questions, and pet route existed lack
  // those keys.
  owner: Pick<TownOwner, 'name'> & Partial<TownOwner>
  pet: Pick<TownPet, 'name'> & Partial<TownPet>
  spawn: TownVector
  movement: TownMovement
  // Rows saved before venues existed hold `{}`, so the venues are parsed on read like a save.
  venues: unknown
  revision: number
  updated_at: Date
  objects: TownObjectRow[]
  residents: TownResidentRow[]
}

export class PostgresStore implements Store {
  constructor(private readonly pool: Pool) {}

  async saveTransaction(transaction: AuthTransaction): Promise<void> {
    await this.pool.query('INSERT INTO oidc_transactions (id_hash, state, nonce, expires_at) VALUES ($1, $2, $3, $4)', [
      await hashToken(transaction.id),
      transaction.state,
      transaction.nonce,
      new Date(transaction.expiresAt),
    ])
  }

  async consumeTransaction(id: string): Promise<AuthTransaction | null> {
    const { rows } = await this.pool.query<TransactionRow>(
      'DELETE FROM oidc_transactions WHERE id_hash = $1 RETURNING state, nonce, expires_at',
      [await hashToken(id)],
    )
    const row = rows[0]
    if (!row) return null
    return { id, state: row.state, nonce: row.nonce, expiresAt: row.expires_at.getTime() }
  }

  async upsertLinkedUser(identity: VerifiedLinkedInIdentity): Promise<LinkedUser> {
    const { rows } = await this.pool.query<UserRow>(
      `INSERT INTO users (id, oidc_issuer, oidc_subject, display_name, email, picture_url)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (oidc_issuer, oidc_subject) DO UPDATE
       SET display_name = EXCLUDED.display_name, email = EXCLUDED.email, picture_url = EXCLUDED.picture_url
       RETURNING *`,
      [
        crypto.randomUUID(),
        identity.issuer,
        identity.subject,
        identity.displayName,
        identity.email,
        identity.pictureUrl,
      ],
    )
    return toUser(firstRow(rows))
  }

  async saveSession(tokenHash: string, userId: string, expiresAt: number): Promise<void> {
    await this.pool.query('INSERT INTO sessions (token_hash, user_id, expires_at) VALUES ($1, $2, $3)', [
      tokenHash,
      userId,
      new Date(expiresAt),
    ])
  }

  async resolveSession(tokenHash: string, now: number): Promise<Actor | null> {
    const { rows } = await this.pool.query<SessionActorRow>(
      `SELECT member.id AS user_id, member.role
       FROM sessions session
       JOIN users member ON member.id = session.user_id
       WHERE session.token_hash = $1 AND session.expires_at >= $2 AND member.deleted_at IS NULL`,
      [tokenHash, new Date(now)],
    )
    return mapFirstRow(rows, toActor)
  }

  async deleteSession(tokenHash: string): Promise<void> {
    await this.pool.query('DELETE FROM sessions WHERE token_hash = $1', [tokenHash])
  }

  async assignRoleByEmail(userId: string, verifiedEmail: string | null): Promise<LinkedUser> {
    const rows = await inTransaction(this.pool, async (client) => {
      // FOR SHARE waits for a removal in progress, so a sign-in never grants admin from an email being removed.
      const listed = await client.query('SELECT 1 FROM admin_emails WHERE email = $1 FOR SHARE', [verifiedEmail])
      const role = listed.rows.length > 0 ? 'admin' : 'member'
      const result = await client.query<UserRow>('UPDATE users SET role = $2 WHERE id = $1 RETURNING *', [userId, role])
      return result.rows
    })
    if (!rows[0]) throw new DomainError('NOT_FOUND', 'User not found')
    return toUser(rows[0])
  }

  async deleteExpiredSessionsAndTransactions(now: number): Promise<void> {
    await this.pool.query(
      `WITH expired_transactions AS (DELETE FROM oidc_transactions WHERE expires_at < $1)
       DELETE FROM sessions WHERE expires_at < $1`,
      [new Date(now)],
    )
  }

  async getUser(id: string): Promise<LinkedUser | null> {
    const { rows } = await this.pool.query<UserRow>('SELECT * FROM users WHERE id = $1', [id])
    return mapFirstRow(rows, toUser)
  }

  /** One statement, so the objects and residents always come from the same committed save. */
  async getTown(id: string): Promise<TownLayout | null> {
    const { rows } = await this.pool.query<TownRow>(
      `SELECT town.*,
         COALESCE((SELECT jsonb_agg(to_jsonb(object) ORDER BY object.sort_order)
                   FROM town_objects object WHERE object.town_id = town.id), '[]') AS objects,
         COALESCE((SELECT jsonb_agg(to_jsonb(resident) ORDER BY resident.sort_order)
                   FROM town_residents resident WHERE resident.town_id = town.id), '[]') AS residents
       FROM towns town WHERE town.id = $1`,
      [id],
    )
    return mapFirstRow(rows, toTown)
  }

  async saveTown(id: string, layout: TownLayoutInput, baseRevision: number): Promise<TownLayout> {
    return inTransaction(this.pool, async (client) => {
      const saved = await claimTownRevision(client, id, layout, baseRevision)
      await client.query('DELETE FROM town_residents WHERE town_id = $1', [id])
      await client.query('DELETE FROM town_objects WHERE town_id = $1', [id])
      await client.query(
        `INSERT INTO town_objects
         (town_id, id, sort_order, type, position_x, position_y, position_z, rotation, scale, color, properties)
         SELECT $1, item.id, item.sort_order, item.type, item.position_x, item.position_y, item.position_z,
                item.rotation, item.scale, item.color, item.properties
         FROM jsonb_to_recordset($2::jsonb) AS item(
           id text, sort_order integer, type text, position_x double precision, position_y double precision,
           position_z double precision, rotation double precision, scale double precision, color text,
           properties jsonb
         )`,
        [id, JSON.stringify(layout.objects.map(toTownObjectRecord))],
      )
      await client.query(
        `INSERT INTO town_residents
         (town_id, id, sort_order, name, appearance, route, bench_object_id, seat_index, start_seated,
          role, relationship, linkedin_profile_url, reference, dialogue)
         SELECT $1, item.id, item.sort_order, item.name, item.appearance, item.route, item.bench_object_id,
                item.seat_index, item.start_seated, item.role, item.relationship,
                item.linkedin_profile_url, item.reference, item.dialogue
         FROM jsonb_to_recordset($2::jsonb) AS item(
           id text, sort_order integer, name text, appearance jsonb, route jsonb, bench_object_id text,
           seat_index integer, start_seated boolean, role jsonb, relationship jsonb,
           linkedin_profile_url text, reference jsonb, dialogue jsonb
         )`,
        [id, JSON.stringify(layout.residents.map(toTownResidentRecord))],
      )
      return { ...structuredClone(layout), id, revision: saved.revision, updatedAt: saved.updated_at.toISOString() }
    })
  }

  async insertGuestbookEntry(entry: GuestbookEntry): Promise<void> {
    await this.pool.query(
      `INSERT INTO guestbook_entries
       (id, visitor_hash, author_appearance, message, locale, status, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        entry.id,
        entry.visitorHash,
        JSON.stringify(entry.appearance),
        entry.message,
        entry.locale,
        entry.status,
        entry.createdAt,
        entry.updatedAt,
      ],
    )
  }

  async listGuestbookEntries(options: { status?: GuestbookStatus; limit: number }): Promise<GuestbookEntry[]> {
    const { rows } = await this.pool.query<GuestbookRow>(
      `SELECT * FROM guestbook_entries WHERE $1::text IS NULL OR status = $1
       ORDER BY created_at DESC, id DESC LIMIT $2`,
      [options.status ?? null, options.limit],
    )
    return rows.map(toGuestbookEntry)
  }

  async getGuestbookEntry(id: string): Promise<GuestbookEntry | null> {
    const { rows } = await this.pool.query<GuestbookRow>('SELECT * FROM guestbook_entries WHERE id = $1', [id])
    return mapFirstRow(rows, toGuestbookEntry)
  }

  async getLatestGuestbookEntryByVisitor(visitorHash: string): Promise<GuestbookEntry | null> {
    const { rows } = await this.pool.query<GuestbookRow>(
      'SELECT * FROM guestbook_entries WHERE visitor_hash = $1 ORDER BY created_at DESC, id DESC LIMIT 1',
      [visitorHash],
    )
    return mapFirstRow(rows, toGuestbookEntry)
  }

  async updateGuestbookEntry(
    id: string,
    expectedUpdatedAt: string,
    changes: GuestbookEntryChanges,
  ): Promise<GuestbookEntry | null> {
    const { rows } = await this.pool.query<GuestbookRow>(
      `UPDATE guestbook_entries SET
         author_appearance = COALESCE($3::jsonb, author_appearance),
         message = COALESCE($4, message),
         locale = COALESCE($5::content_locale, locale),
         status = COALESCE($6, status),
         updated_at = COALESCE($7::timestamptz, updated_at)
       WHERE id = $1 AND updated_at = $2::timestamptz RETURNING *`,
      [
        id,
        expectedUpdatedAt,
        changes.appearance ? JSON.stringify(changes.appearance) : null,
        changes.message ?? null,
        changes.locale ?? null,
        changes.status ?? null,
        changes.updatedAt ?? null,
      ],
    )
    return mapFirstRow(rows, toGuestbookEntry)
  }

  async deleteGuestbookEntry(id: string): Promise<void> {
    await this.pool.query('DELETE FROM guestbook_entries WHERE id = $1', [id])
  }

  async seedAdminEmails(emails: readonly string[]): Promise<boolean> {
    const { rowCount } = await this.pool.query(
      `INSERT INTO admin_emails (email)
       SELECT DISTINCT email FROM unnest($1::text[]) AS email
       WHERE NOT EXISTS (SELECT 1 FROM admin_emails)
       ON CONFLICT (email) DO NOTHING`,
      [emails],
    )
    return (rowCount ?? 0) > 0
  }

  async listAdminEmails(): Promise<AdminEmail[]> {
    const { rows } = await this.pool.query<AdminEmailRow>(
      'SELECT email, created_at FROM admin_emails ORDER BY email COLLATE "C"',
    )
    return rows.map(toAdminEmail)
  }

  async addAdminEmail(email: string): Promise<AdminEmail> {
    const { rows } = await this.pool.query<AdminEmailRow>(
      'INSERT INTO admin_emails (email) VALUES ($1) ON CONFLICT (email) DO NOTHING RETURNING email, created_at',
      [email],
    )
    if (!rows[0]) throw adminEmailAlreadyListed()
    return toAdminEmail(rows[0])
  }

  async removeAdminEmail(email: string): Promise<void> {
    await inTransaction(this.pool, async (client) => {
      // Locking every row serializes removals, so two admins cannot each remove one of the last two emails.
      const { rows } = await client.query<{ email: string }>('SELECT email FROM admin_emails FOR UPDATE')
      if (!rows.some((row) => row.email === email)) throw adminEmailNotListed()
      if (rows.length === 1) throw lastAdminEmail()
      await client.query('DELETE FROM admin_emails WHERE email = $1', [email])
      await client.query(
        `WITH demoted AS (UPDATE users SET role = 'member' WHERE lower(btrim(email)) = $1 RETURNING id)
         DELETE FROM sessions WHERE user_id IN (SELECT id FROM demoted)`,
        [email],
      )
    })
  }

  async issueRun(run: GameRun): Promise<void> {
    await inTransaction(this.pool, async (client) => {
      // Without it, two issues at once would each find nothing to abandon, and the second would break the one-open index.
      await lockVisitorGame(client, run.game, run.visitorHash)
      await client.query(
        `UPDATE minigame_runs SET status = 'abandoned' WHERE game = $1 AND visitor_hash = $2 AND status = 'issued'`,
        [run.game, run.visitorHash],
      )
      await client.query(
        `INSERT INTO minigame_runs (id, game, season, visitor_hash, seed, rules, status, issued_at, expires_at)
         VALUES ($1, $2, $3, $4, $5, $6, 'issued', $7, $8)`,
        [
          run.id,
          run.game,
          run.season,
          run.visitorHash,
          run.seed,
          JSON.stringify(run.rules),
          run.issuedAt,
          run.expiresAt,
        ],
      )
    })
  }

  async getRun(id: string): Promise<GameRun | null> {
    const { rows } = await this.pool.query<GameRunRow>('SELECT * FROM minigame_runs WHERE id = $1', [id])
    return mapFirstRow(rows, toGameRun)
  }

  async finishRun(
    id: string,
    visitorHash: string,
    finished: FinishedRun,
    settle: SettleEntry | null,
  ): Promise<{ run: GameRun; settlement: EntrySettlement | null } | null> {
    return inTransaction(this.pool, async (client) => {
      await lockRunVisitor(client, id)
      // The row lock this takes makes a second result for the same run wait, then find it no longer issued.
      const { rows } = await client.query<GameRunRow>(
        `UPDATE minigame_runs
         SET status = $3, submitted_at = $4, input_log = $5, result = $6, score = $7, tiebreak = $8, flags = $9,
           profile = $10
         WHERE id = $1 AND visitor_hash = $2 AND status = 'issued' AND expires_at > $4 RETURNING *`,
        [
          id,
          visitorHash,
          finished.status,
          finished.submittedAt,
          jsonOrNull(finished.inputLog),
          jsonOrNull(finished.result),
          finished.score,
          finished.tiebreak,
          finished.flags,
          jsonOrNull(finished.profile),
        ],
      )
      const row = rows[0]
      if (!row) return null
      const run = toGameRun(row)
      return { run, settlement: settle ? await settleEntryWithin(client, run, settle) : null }
    })
  }

  async getBoardEntryByVisitor(board: BoardKey, visitorHash: string): Promise<LeaderboardEntry | null> {
    const { rows } = await this.pool.query<LeaderboardEntryRow>(
      'SELECT * FROM minigame_entries WHERE game = $1 AND season = $2 AND visitor_hash = $3',
      [board.game, board.season, visitorHash],
    )
    return mapFirstRow(rows, toLeaderboardEntry)
  }

  async rankOf(entry: LeaderboardEntry): Promise<number> {
    const { rows } = await this.pool.query<{ ahead: number }>(
      `SELECT count(*)::integer AS ahead FROM minigame_entries
       WHERE game = $1 AND season = $2 AND listed AND review_status <> 'disqualified'
         AND (score > $3 OR (score = $3 AND (tiebreak > $4
           OR (tiebreak = $4 AND (achieved_at, id) < ($5::timestamptz, $6::uuid)))))`,
      [entry.game, entry.season, entry.score, entry.tiebreak, entry.achievedAt, entry.id],
    )
    return firstRow(rows).ahead + 1
  }

  async listBoard(board: BoardKey, limit: number): Promise<LeaderboardEntry[]> {
    const { rows } = await this.pool.query<LeaderboardEntryRow>(
      `SELECT * FROM minigame_entries
       WHERE game = $1 AND season = $2 AND listed AND review_status <> 'disqualified'
       ORDER BY score DESC, tiebreak DESC, achieved_at, id LIMIT $3`,
      [board.game, board.season, limit],
    )
    return rows.map(toLeaderboardEntry)
  }

  async updateEntry(id: string, expectedUpdatedAt: string, changes: EntryChanges): Promise<LeaderboardEntry | null> {
    const { rows } = await this.pool.query<LeaderboardEntryRow>(
      `UPDATE minigame_entries SET author_name = $3, name_status = $4, author_appearance = $5, appearance_public = $6,
         listed = $7, review_status = $8, linkedin_profile_url = $9, linkedin_status = $10, linkedin_code = $11,
         takedown = $12, updated_at = $13
       WHERE id = $1 AND updated_at = $2::timestamptz RETURNING *`,
      [
        id,
        expectedUpdatedAt,
        changes.authorName,
        changes.nameStatus,
        JSON.stringify(changes.appearance),
        changes.appearancePublic,
        changes.listed,
        changes.reviewStatus,
        changes.linkedIn?.profileUrl ?? null,
        changes.linkedIn?.status ?? null,
        changes.linkedIn?.code ?? null,
        changes.takedown,
        changes.updatedAt,
      ],
    )
    return mapFirstRow(rows, toLeaderboardEntry)
  }

  async getEntry(id: string): Promise<LeaderboardEntry | null> {
    const { rows } = await this.pool.query<LeaderboardEntryRow>('SELECT * FROM minigame_entries WHERE id = $1', [id])
    return mapFirstRow(rows, toLeaderboardEntry)
  }

  async listEntries(board: BoardKey): Promise<LeaderboardEntry[]> {
    const { rows } = await this.pool.query<LeaderboardEntryRow>(
      `SELECT * FROM minigame_entries WHERE game = $1 AND season = $2
       ORDER BY score DESC, tiebreak DESC, achieved_at, id`,
      [board.game, board.season],
    )
    return rows.map(toLeaderboardEntry)
  }

  async listEndedSeasons(game: string, currentSeason: string): Promise<string[]> {
    const { rows } = await this.pool.query<{ season: string }>(
      'SELECT DISTINCT season FROM minigame_entries WHERE game = $1 AND season < $2 ORDER BY season DESC',
      [game, currentSeason],
    )
    return rows.map(({ season }) => season)
  }

  async listRunsForReview(board: BoardKey): Promise<GameRun[]> {
    const { rows } = await this.pool.query<GameRunRow>(
      `SELECT * FROM minigame_runs
       WHERE game = $1 AND season = $2 AND status = 'flagged' AND reviewed_at IS NULL ORDER BY submitted_at, id`,
      [board.game, board.season],
    )
    return rows.map(toGameRun)
  }

  async countRunsByVisitor(board: BoardKey): Promise<VisitorRunCounts[]> {
    const { rows } = await this.pool.query<VisitorRunCountsRow>(
      `SELECT visitor_hash, count(*)::integer AS runs,
         count(*) FILTER (WHERE status = 'abandoned')::integer AS abandoned,
         count(*) FILTER (WHERE status = 'flagged')::integer AS flagged
       FROM minigame_runs WHERE game = $1 AND season = $2 GROUP BY visitor_hash`,
      [board.game, board.season],
    )
    return rows.map((row) => ({
      visitorHash: row.visitor_hash,
      runs: row.runs,
      abandoned: row.abandoned,
      flagged: row.flagged,
    }))
  }

  async hasSubmittedRun(game: string, visitorHash: string): Promise<boolean> {
    const { rows } = await this.pool.query(
      'SELECT 1 FROM minigame_runs WHERE game = $1 AND visitor_hash = $2 AND submitted_at IS NOT NULL LIMIT 1',
      [game, visitorHash],
    )
    return rows.length > 0
  }

  async acceptRun(
    id: string,
    reviewedAt: string,
    settle: SettleEntry,
  ): Promise<{ run: GameRun; settlement: EntrySettlement } | null> {
    // A throwing `settle` rolls the acceptance back with the record.
    return inTransaction(this.pool, async (client) => {
      await lockRunVisitor(client, id)
      const { rows } = await client.query<GameRunRow>(
        `UPDATE minigame_runs SET status = 'scored', reviewed_at = $2
         WHERE id = $1 AND status = 'flagged' AND reviewed_at IS NULL RETURNING *`,
        [id, reviewedAt],
      )
      const row = rows[0]
      if (!row) return null
      const run = toGameRun(row)
      return { run, settlement: await settleEntryWithin(client, run, settle) }
    })
  }

  async rejectRun(id: string, reviewedAt: string): Promise<GameRun | null> {
    const { rows } = await this.pool.query<GameRunRow>(
      `UPDATE minigame_runs SET reviewed_at = $2
       WHERE id = $1 AND status = 'flagged' AND reviewed_at IS NULL RETURNING *`,
      [id, reviewedAt],
    )
    return mapFirstRow(rows, toGameRun)
  }

  async rejectRuns(game: string, ids: readonly string[], reviewedAt: string): Promise<number> {
    const { rowCount } = await this.pool.query(
      `UPDATE minigame_runs SET reviewed_at = $3
       WHERE game = $1 AND id = ANY($2::uuid[]) AND status = 'flagged' AND reviewed_at IS NULL`,
      [game, ids, reviewedAt],
    )
    return rowCount ?? 0
  }

  async addReport(report: EntryReport): Promise<void> {
    await this.pool.query(
      `INSERT INTO minigame_reports (id, entry_id, target, reason, created_at, resolved_at, resolution)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [report.id, report.entryId, report.target, report.reason, report.createdAt, report.resolvedAt, report.resolution],
    )
  }

  async listReports(board: BoardKey): Promise<EntryReport[]> {
    const { rows } = await this.pool.query<EntryReportRow>(
      `SELECT r.* FROM minigame_reports r JOIN minigame_entries e ON e.id = r.entry_id
       WHERE e.game = $1 AND e.season = $2 ORDER BY r.created_at, r.id`,
      [board.game, board.season],
    )
    return rows.map(toEntryReport)
  }

  async resolveReports(
    entryId: string,
    target: ReportTarget,
    resolution: ReportResolution,
    resolvedAt: string,
  ): Promise<void> {
    await this.pool.query(
      `UPDATE minigame_reports SET resolution = $3, resolved_at = $4
       WHERE entry_id = $1 AND target = $2 AND resolved_at IS NULL`,
      [entryId, target, resolution, resolvedAt],
    )
  }

  async forgetKeptReports(entryId: string, targets: readonly ReportTarget[]): Promise<void> {
    await this.pool.query(
      `DELETE FROM minigame_reports WHERE entry_id = $1 AND target = ANY($2::text[]) AND resolution = 'kept'`,
      [entryId, targets],
    )
  }

  async isLinkBlocked(profileHash: string): Promise<boolean> {
    const { rows } = await this.pool.query('SELECT 1 FROM minigame_link_blocks WHERE profile_hash = $1', [profileHash])
    return rows.length > 0
  }

  async blockLink(profileHash: string, createdAt: string): Promise<void> {
    await this.pool.query(
      'INSERT INTO minigame_link_blocks (profile_hash, created_at) VALUES ($1, $2) ON CONFLICT DO NOTHING',
      [profileHash, createdAt],
    )
  }

  async eraseVisitorGameData(game: string, visitorHash: string): Promise<void> {
    await inTransaction(this.pool, async (client) => {
      // Without it, a run finished or accepted meanwhile could settle a record after the records below are deleted.
      await lockVisitorGame(client, game, visitorHash)
      // Records first, which takes their reports with them, so no record points at a run being deleted.
      await client.query('DELETE FROM minigame_entries WHERE game = $1 AND visitor_hash = $2', [game, visitorHash])
      await client.query('DELETE FROM minigame_runs WHERE game = $1 AND visitor_hash = $2', [game, visitorHash])
    })
  }
}

/**
 * Settles the visitor's record on the finished run's board inside its transaction. The caller holds the visitor's lock
 * (`lockVisitorGame`), so no other run creates or deletes the record meanwhile, and the record's row lock keeps an
 * owner's or admin's change from landing in between.
 */
export async function settleEntryWithin(
  client: PoolClient,
  run: GameRun,
  settle: SettleEntry,
): Promise<EntrySettlement> {
  const { rows } = await client.query<LeaderboardEntryRow>(
    'SELECT * FROM minigame_entries WHERE game = $1 AND season = $2 AND visitor_hash = $3 FOR UPDATE',
    [run.game, run.season, run.visitorHash],
  )
  const current = mapFirstRow(rows, toLeaderboardEntry)
  const settlement = settle(current, current ? null : await latestEntry(client, run.game, run.visitorHash))
  if (settlement.changed) await writeEntry(client, settlement.entry)
  return settlement
}

/**
 * Serializes the transactions that create or delete one visitor's runs and records of a game: issuing, finishing, and
 * accepting a run, and erasing them all. Each takes it first, before any row lock, so they never deadlock.
 */
export async function lockVisitorGame(client: PoolClient, game: string, visitorHash: string): Promise<void> {
  await client.query('SELECT pg_advisory_xact_lock($1, hashtext($2))', [visitorGameLockSpace, `${game}:${visitorHash}`])
}

/** `lockVisitorGame` for a stored run's visitor and game; nothing for a run that does not exist. */
export async function lockRunVisitor(client: PoolClient, runId: string): Promise<void> {
  const { rows } = await client.query<{ game: string; visitor_hash: string }>(
    'SELECT game, visitor_hash FROM minigame_runs WHERE id = $1',
    [runId],
  )
  const run = rows[0]
  if (run) await lockVisitorGame(client, run.game, run.visitor_hash)
}

export async function latestEntry(client: PoolClient, game: string, visitorHash: string) {
  const { rows } = await client.query<LeaderboardEntryRow>(
    'SELECT * FROM minigame_entries WHERE game = $1 AND visitor_hash = $2 ORDER BY season DESC LIMIT 1',
    [game, visitorHash],
  )
  return mapFirstRow(rows, toLeaderboardEntry)
}

export async function writeEntry(client: PoolClient, entry: LeaderboardEntry): Promise<void> {
  await client.query(
    `INSERT INTO minigame_entries
     (id, game, season, visitor_hash, best_run_id, score, tiebreak, result, achieved_at, author_name, name_status,
      author_appearance, listed, review_status, created_at, updated_at, appearance_public, linkedin_profile_url,
      linkedin_status, linkedin_code, takedown)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21)
     ON CONFLICT (id) DO UPDATE SET
       best_run_id = EXCLUDED.best_run_id, score = EXCLUDED.score, tiebreak = EXCLUDED.tiebreak,
       result = EXCLUDED.result, achieved_at = EXCLUDED.achieved_at, author_name = EXCLUDED.author_name,
       name_status = EXCLUDED.name_status, author_appearance = EXCLUDED.author_appearance, listed = EXCLUDED.listed,
       review_status = EXCLUDED.review_status, updated_at = EXCLUDED.updated_at,
       appearance_public = EXCLUDED.appearance_public, linkedin_profile_url = EXCLUDED.linkedin_profile_url,
       linkedin_status = EXCLUDED.linkedin_status, linkedin_code = EXCLUDED.linkedin_code, takedown = EXCLUDED.takedown`,
    [
      entry.id,
      entry.game,
      entry.season,
      entry.visitorHash,
      entry.bestRunId,
      entry.score,
      entry.tiebreak,
      JSON.stringify(entry.result),
      entry.achievedAt,
      entry.authorName,
      entry.nameStatus,
      JSON.stringify(entry.appearance),
      entry.listed,
      entry.reviewStatus,
      entry.createdAt,
      entry.updatedAt,
      entry.appearancePublic,
      entry.linkedIn?.profileUrl ?? null,
      entry.linkedIn?.status ?? null,
      entry.linkedIn?.code ?? null,
      entry.takedown,
    ],
  )
}

/** A jsonb parameter; `null` stays SQL NULL rather than the JSON value null, which an object check would refuse. */
export function jsonOrNull(value: unknown): string | null {
  return value === null ? null : JSON.stringify(value)
}

export function toGameRun(row: GameRunRow): GameRun {
  return {
    id: row.id,
    game: row.game,
    season: row.season,
    visitorHash: row.visitor_hash,
    seed: Number(row.seed),
    rules: row.rules,
    status: row.status,
    issuedAt: row.issued_at.toISOString(),
    expiresAt: row.expires_at.toISOString(),
    submittedAt: row.submitted_at?.toISOString() ?? null,
    inputLog: row.input_log,
    result: row.result,
    score: row.score,
    tiebreak: row.tiebreak,
    flags: row.flags,
    profile: row.profile,
    reviewedAt: row.reviewed_at?.toISOString() ?? null,
  }
}

export function toLeaderboardEntry(row: LeaderboardEntryRow): LeaderboardEntry {
  return {
    id: row.id,
    game: row.game,
    season: row.season,
    visitorHash: row.visitor_hash,
    bestRunId: row.best_run_id,
    score: row.score,
    tiebreak: row.tiebreak,
    result: row.result,
    achievedAt: row.achieved_at.toISOString(),
    authorName: row.author_name,
    nameStatus: row.name_status,
    appearance: row.author_appearance,
    appearancePublic: row.appearance_public,
    listed: row.listed,
    reviewStatus: row.review_status,
    linkedIn: toEntryLinkedIn(row),
    takedown: row.takedown,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  }
}

/** The three columns are all set or all null (a table check). */
export function toEntryLinkedIn(row: LeaderboardEntryRow): LeaderboardEntry['linkedIn'] {
  if (row.linkedin_profile_url === null || row.linkedin_status === null || row.linkedin_code === null) return null
  return { profileUrl: row.linkedin_profile_url, status: row.linkedin_status, code: row.linkedin_code }
}

export function toEntryReport(row: EntryReportRow): EntryReport {
  return {
    id: row.id,
    entryId: row.entry_id,
    target: row.target,
    reason: row.reason,
    createdAt: row.created_at.toISOString(),
    resolvedAt: row.resolved_at?.toISOString() ?? null,
    resolution: row.resolution,
  }
}

/**
 * Applies pending `*.sql` files in name order within one transaction. The advisory lock keeps concurrently
 * starting instances from applying the same migration twice. `directory` must end with a slash.
 */
export async function applyMigrations(pool: Pool, directory: URL): Promise<string[]> {
  const fileNames = (await readdir(directory)).filter((name) => name.endsWith('.sql')).sort()
  return inTransaction(pool, async (client) => {
    await client.query('SELECT pg_advisory_xact_lock($1)', [migrationLockKey])
    await client.query(
      'CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())',
    )
    const { rows } = await client.query<{ name: string }>('SELECT name FROM schema_migrations')
    const applied = new Set(rows.map((row) => row.name))
    const pending = fileNames.filter((name) => !applied.has(name))
    for (const name of pending) {
      await client.query(await readFile(new URL(name, directory), 'utf8'))
      await client.query('INSERT INTO schema_migrations (name) VALUES ($1)', [name])
    }
    return pending
  })
}

export async function inTransaction<T>(pool: Pool, work: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const result = await work(client)
    await client.query('COMMIT')
    return result
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally {
    client.release()
  }
}

export function firstRow<Row>(rows: Row[]): Row {
  const row = rows[0]
  if (!row) throw new Error('Expected the statement to return a row')
  return row
}

export function mapFirstRow<Row, Value>(rows: Row[], convert: (row: Row) => Value): Value | null {
  const row = rows[0]
  return row === undefined ? null : convert(row)
}

export function toActor(row: SessionActorRow): Actor {
  return { kind: 'linked', userId: row.user_id, role: row.role }
}

export function toUser(row: UserRow): LinkedUser {
  return {
    id: row.id,
    oidcIssuer: row.oidc_issuer,
    oidcSubject: row.oidc_subject,
    displayName: row.display_name,
    email: row.email,
    pictureUrl: row.picture_url,
    role: row.role,
    createdAt: row.created_at.toISOString(),
    deletedAt: row.deleted_at?.toISOString() ?? null,
  }
}

export function toAdminEmail(row: AdminEmailRow): AdminEmail {
  return { email: row.email, createdAt: row.created_at.toISOString() }
}

export function toGuestbookEntry(row: GuestbookRow): GuestbookEntry {
  return {
    id: row.id,
    visitorHash: row.visitor_hash,
    appearance: row.author_appearance,
    message: row.message,
    locale: row.locale,
    status: row.status,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  }
}

/** Inserts the first revision or advances the current one; the row lock serializes concurrent saves. */
export async function claimTownRevision(
  client: PoolClient,
  id: string,
  layout: TownLayoutInput,
  baseRevision: number,
): Promise<{ revision: number; updated_at: Date }> {
  const townFields = [
    id,
    layout.name,
    JSON.stringify(layout.spawn),
    JSON.stringify(layout.movement),
    JSON.stringify(layout.owner),
    JSON.stringify(layout.pet),
    JSON.stringify(layout.venues),
  ]
  const { rows } =
    baseRevision === 0
      ? await client.query<{ revision: number; updated_at: Date }>(
          `INSERT INTO towns (id, name, spawn, movement, owner, pet, venues, revision)
           VALUES ($1, $2, $3, $4, $5, $6, $7, 1)
           ON CONFLICT (id) DO NOTHING RETURNING revision, updated_at`,
          townFields,
        )
      : await client.query<{ revision: number; updated_at: Date }>(
          `UPDATE towns SET name = $2, spawn = $3, movement = $4, owner = $5, pet = $6, venues = $7,
             revision = revision + 1, updated_at = now()
           WHERE id = $1 AND revision = $8 RETURNING revision, updated_at`,
          [...townFields, baseRevision],
        )
  const saved = rows[0]
  if (!saved) throw new DomainError('CONFLICT', 'The town changed since it was loaded')
  return saved
}

export function toTownObjectRecord(object: TownObject, sortOrder: number) {
  const { id, type, position, rotation, scale, color, ...properties } = object
  return {
    id,
    sort_order: sortOrder,
    type,
    position_x: position.x,
    position_y: position.y,
    position_z: position.z,
    rotation,
    scale,
    color,
    properties,
  }
}

export function toTownResidentRecord(resident: TownLayoutInput['residents'][number], sortOrder: number) {
  return {
    id: resident.id,
    sort_order: sortOrder,
    name: resident.name,
    appearance: resident.appearance,
    route: resident.route,
    bench_object_id: resident.benchId,
    seat_index: resident.seatIndex,
    start_seated: resident.startSeated,
    role: resident.role,
    relationship: resident.relationship,
    linkedin_profile_url: resident.linkedInProfileUrl,
    reference: resident.reference,
    dialogue: resident.dialogue,
  }
}

export function toTown(row: TownRow): TownLayout {
  return {
    id: row.id,
    name: row.name,
    owner: { introduction: null, contactEmail: null, residentId: null, questions: [], ...row.owner },
    pet: { route: null, ...row.pet },
    spawn: row.spawn,
    movement: row.movement,
    venues: parseTownVenues(row.venues),
    revision: row.revision,
    updatedAt: row.updated_at.toISOString(),
    objects: row.objects.map(
      ({ id, type, position_x, position_y, position_z, rotation, scale, color, properties }) => ({
        ...properties,
        id,
        type,
        position: { x: position_x, y: position_y, z: position_z },
        rotation,
        scale,
        color,
      }),
    ),
    residents: row.residents.map((resident) => ({
      id: resident.id,
      name: resident.name,
      appearance: resident.appearance,
      route: resident.route,
      benchId: resident.bench_object_id,
      seatIndex: resident.seat_index,
      startSeated: resident.start_seated,
      role: resident.role,
      relationship: resident.relationship,
      linkedInProfileUrl: resident.linkedin_profile_url,
      reference: resident.reference,
      dialogue: resident.dialogue,
    })),
  }
}
