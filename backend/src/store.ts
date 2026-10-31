import { adminEmailAlreadyListed, adminEmailNotListed, lastAdminEmail, type AdminEmail } from './admins.js'
import type { Actor, LinkedUser } from './domain.js'
import { DomainError } from './domain.js'
import type { AuthStore, AuthTransaction, VerifiedLinkedInIdentity } from './auth.js'
import type { GuestbookEntry, GuestbookStatus } from './guestbook.js'
import type { TownLayout, TownLayoutInput } from './town.js'

export interface Store extends AuthStore {
  getUser(id: string): Promise<LinkedUser | null>
  /** `null` until the admin saves the town for the first time. */
  getTown(id: string): Promise<TownLayout | null>
  /**
   * Replaces the whole layout and increments its revision, but only while `baseRevision` is still current
   * (0 for a town that was never saved); otherwise rejects with CONFLICT and keeps the stored layout.
   */
  saveTown(id: string, layout: TownLayoutInput, baseRevision: number): Promise<TownLayout>
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
  readonly towns = new Map<string, TownLayout>()
  readonly guestbookEntries = new Map<string, GuestbookEntry>()
  readonly transactions = new Map<string, AuthTransaction>()
  readonly sessions = new Map<string, SessionRow>()
  readonly adminEmails = new Map<string, AdminEmail>()

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

  async getTown(id: string): Promise<TownLayout | null> {
    const town = this.towns.get(id)
    return town ? structuredClone(town) : null
  }

  async saveTown(id: string, layout: TownLayoutInput, baseRevision: number): Promise<TownLayout> {
    const currentRevision = this.towns.get(id)?.revision ?? 0
    if (currentRevision !== baseRevision) throw new DomainError('CONFLICT', 'The town changed since it was loaded')
    const town: TownLayout = {
      ...structuredClone(layout),
      id,
      revision: currentRevision + 1,
      updatedAt: new Date().toISOString(),
    }
    this.towns.set(id, town)
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
}

export function deleteExpiredRecords(records: Map<string, { expiresAt: number }>, now: number): void {
  const expiredKeys = [...records].filter(([, record]) => record.expiresAt < now).map(([key]) => key)
  expiredKeys.forEach((key) => records.delete(key))
}

export function newestFirst(entries: GuestbookEntry[]): GuestbookEntry[] {
  return entries.sort((left, right) => right.createdAt.localeCompare(left.createdAt) || right.id.localeCompare(left.id))
}
