import { oidcTransactionLifetimeMs, randomToken, type LinkedInOidcAdapter } from './auth.js'
import { DomainError } from './domain.js'
import { entryChanges, type EntryChanges, type LeaderboardEntry } from './leaderboard.js'

// A visitor's LinkedIn sign-in that makes their record's link public. It is not the admin sign-in of auth.ts and shares
// nothing with it but the provider: it makes no user and no session, so it can grant nothing. It belongs to the
// anonymous visitor cookie and to one record, and keeps of the LinkedIn account only its display name, on that record,
// for the admin to compare with the address. Sign-in cannot prove the address is the account's own: LinkedIn's OIDC
// returns no profile address.

/**
 * What every state of this flow starts with. The LinkedIn app has one registered callback address, so both sign-ins
 * return through it, and this tells them apart: an admin sign-in's state is base64url, which has no dot. It only picks
 * which flow checks the callback; each then checks the whole state against its own stored transaction and cookie.
 */
export const linkVerificationStatePrefix = 'link.'
/** The longest display name kept, in code points; LinkedIn's own are shorter. */
export const verifiedNameLength = 100

/** One started sign-in: one use, for ten minutes, for one visitor's one record and the address it had then. */
export interface LinkVerification {
  /** Kept only in the browser's `__Host-tom_link` cookie; the store holds its hash. */
  id: string
  state: string
  nonce: string
  visitorHash: string
  entryId: string
  profileUrl: string
  expiresAt: number
}

export interface LinkVerificationStore {
  saveLinkVerification(verification: LinkVerification): Promise<void>
  /** Returns the verification and deletes it, so it is used once; `null` when there is none. */
  consumeLinkVerification(id: string): Promise<LinkVerification | null>
  /** Runs before every start, so abandoned sign-ins cannot pile up in storage. */
  deleteExpiredLinkVerifications(now: number): Promise<void>
}

export function isLinkVerificationState(state: string | null): boolean {
  return state !== null && state.startsWith(linkVerificationStatePrefix)
}

/** Whether the record's link is `profileUrl` and still waits for its visitor's sign-in. */
export function awaitsSignIn(entry: LeaderboardEntry, profileUrl: string): boolean {
  return entry.linkedIn?.status === 'unverified' && entry.linkedIn.profileUrl === profileUrl
}

/** A sign-in for the record's link as it stands; `409` when no link waits for one. */
export function newLinkVerification(entry: LeaderboardEntry, now: number): LinkVerification {
  const link = entry.linkedIn
  if (link?.status !== 'unverified') {
    throw new DomainError('CONFLICT', 'The record has no link waiting for a LinkedIn sign-in')
  }
  return {
    id: randomToken(),
    state: `${linkVerificationStatePrefix}${randomToken()}`,
    nonce: randomToken(),
    visitorHash: entry.visitorHash,
    entryId: entry.id,
    profileUrl: link.profileUrl,
    expiresAt: now + oidcTransactionLifetimeMs,
  }
}

/** Without the `email` scope the admin sign-in asks for: this flow has no use for an address. */
export function linkAuthorizationUrl(adapter: LinkedInOidcAdapter, verification: LinkVerification): string {
  return adapter
    .createAuthorizationUrl({ state: verification.state, nonce: verification.nonce, scopes: ['openid', 'profile'] })
    .toString()
}

/**
 * A callback counts only for a verification that exists, has not expired, carries this state, and was started by this
 * browser's visitor cookie. Each failure reads the same, so a callback learns nothing about another visitor's sign-in.
 */
export function assertVerificationMatches(
  verification: LinkVerification | null,
  state: string,
  visitorHash: string | null,
  now: number,
): asserts verification is LinkVerification {
  const matches =
    verification !== null &&
    verification.expiresAt >= now &&
    verification.state === state &&
    verification.visitorHash === visitorHash
  if (!matches) throw new DomainError('FORBIDDEN', 'Invalid or expired link verification')
}

/** The account's display name on one line, at most `verifiedNameLength` code points; one that is blank is refused. */
export function verifiedDisplayName(name: string): string {
  const oneLine = Array.from(name.replace(/\s+/gu, ' ').trim()).slice(0, verifiedNameLength).join('').trim()
  if (oneLine === '') throw new DomainError('FORBIDDEN', 'LinkedIn returned no display name')
  return oneLine
}

/** The record's link made public, with the signed-in account's display name and nothing else of it. */
export function verifiedLinkChanges(
  entry: LeaderboardEntry,
  verification: LinkVerification,
  displayName: string,
  now: string,
): EntryChanges {
  if (entry.visitorHash !== verification.visitorHash || !awaitsSignIn(entry, verification.profileUrl)) {
    throw new DomainError('CONFLICT', 'The link changed after the sign-in started')
  }
  const linkedIn = {
    profileUrl: verification.profileUrl,
    status: 'verified' as const,
    verifiedName: verifiedDisplayName(displayName),
  }
  return entryChanges(entry, { linkedIn }, now)
}
