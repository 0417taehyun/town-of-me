import { verifiedEmail } from './admins.js'
import { DomainError, type Actor, type LinkedUser } from './domain.js'

export interface VerifiedLinkedInIdentity {
  /** Adapter must verify signature, iss, aud, exp, and any returned nonce first. */
  issuer: string
  subject: string
  displayName: string
  email: string | null
  /** True only when the provider asserts the email is verified; admin configuration trusts nothing else. */
  emailVerified: boolean
  pictureUrl: string | null
}

export interface LinkedInOidcAdapter {
  createAuthorizationUrl(input: { state: string; nonce: string; scopes: readonly ['openid', 'profile', 'email'] }): URL
  exchangeAndVerify(input: { code: string; expectedNonce: string }): Promise<VerifiedLinkedInIdentity>
}

export interface AuthTransaction {
  id: string
  state: string
  nonce: string
  expiresAt: number
}

export interface AuthStore {
  saveTransaction(transaction: AuthTransaction): Promise<void>
  consumeTransaction(id: string): Promise<AuthTransaction | null>
  upsertLinkedUser(identity: VerifiedLinkedInIdentity): Promise<LinkedUser>
  saveSession(tokenHash: string, userId: string, expiresAt: number): Promise<void>
  resolveSession(tokenHash: string, now: number): Promise<Actor | null>
  deleteSession(tokenHash: string): Promise<void>
  /** Runs before every sign-in, so abandoned sign-ins and expired sessions cannot pile up in storage. */
  deleteExpiredSessionsAndTransactions(now: number): Promise<void>
  /**
   * Runs on every sign-in: `admin` when `verifiedEmail` is on the admin list, otherwise `member`, so a removed
   * or changed email loses the role at the next sign-in.
   */
  assignRoleByEmail(userId: string, verifiedEmail: string | null): Promise<LinkedUser>
}

const encoder = new TextEncoder()
export const oidcTransactionLifetimeMs = 10 * 60_000
export const sessionLifetimeMs = 30 * 24 * 60 * 60_000

export function base64UrlEncode(bytes: Uint8Array): string {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/u, '')
}

export function randomToken(bytes = 32): string {
  return base64UrlEncode(crypto.getRandomValues(new Uint8Array(bytes)))
}

export async function hashToken(token: string): Promise<string> {
  return base64UrlEncode(new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(token))))
}

export async function beginLinkedInLogin(
  adapter: LinkedInOidcAdapter | undefined,
  store: AuthStore,
  now = Date.now(),
): Promise<{ authorizationUrl: string; transactionId: string }> {
  if (!adapter) throw new DomainError('NOT_CONFIGURED', 'LinkedIn OIDC is not configured')
  const transaction: AuthTransaction = {
    id: randomToken(),
    state: randomToken(),
    nonce: randomToken(),
    expiresAt: now + oidcTransactionLifetimeMs,
  }
  await store.deleteExpiredSessionsAndTransactions(now)
  await store.saveTransaction(transaction)
  return {
    authorizationUrl: adapter
      .createAuthorizationUrl({
        state: transaction.state,
        nonce: transaction.nonce,
        scopes: ['openid', 'profile', 'email'],
      })
      .toString(),
    transactionId: transaction.id,
  }
}

export async function completeLinkedInLogin(input: {
  adapter: LinkedInOidcAdapter | undefined
  store: AuthStore
  transactionId: string
  state: string
  code: string
  now?: number
}): Promise<{ user: LinkedUser; sessionToken: string }> {
  if (!input.adapter) throw new DomainError('NOT_CONFIGURED', 'LinkedIn OIDC is not configured')
  const transaction = await input.store.consumeTransaction(input.transactionId)
  const now = input.now ?? Date.now()
  if (!transaction || transaction.expiresAt < now || transaction.state !== input.state) {
    throw new DomainError('FORBIDDEN', 'Invalid or expired OIDC transaction')
  }
  const identity = await input.adapter.exchangeAndVerify({
    code: input.code,
    expectedNonce: transaction.nonce,
  })
  const signedIn = await input.store.upsertLinkedUser(identity)
  const user = await input.store.assignRoleByEmail(signedIn.id, verifiedEmail(identity))
  const sessionToken = randomToken()
  await input.store.saveSession(await hashToken(sessionToken), user.id, now + sessionLifetimeMs)
  return { user, sessionToken }
}
