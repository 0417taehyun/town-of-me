import { DomainError } from './domain.js'
import { invalidInput, matchingText } from './validation.js'

/** One address on the admin list; a verified LinkedIn sign-in with it gets the admin role. */
export interface AdminEmail {
  email: string
  createdAt: string
}

const emailPattern = /^[^\s@\p{Cc}]+@[^\s@\p{Cc}]+\.[^\s@\p{Cc}]+$/u
const emailLengthLimit = 254

/** An admin list entry, kept trimmed and lowercase so a sign-in matches it however LinkedIn cases the address. */
export function adminEmail(value: unknown, field = 'email'): string {
  const email = typeof value === 'string' ? value.trim().toLowerCase() : value
  const shaped = matchingText(email, emailPattern, field, 'an email address like name@example.com')
  if (shaped.length > emailLengthLimit) throw invalidInput(`${field} must be at most ${emailLengthLimit} characters`)
  return shaped
}

/** `ADMIN_EMAILS`: the comma-separated list that fills an empty admin list at startup. */
export function parseEmailList(value: string | undefined): string[] {
  return (value ?? '')
    .split(',')
    .map((email) => email.trim())
    .filter(Boolean)
    .map((email) => adminEmail(email, 'ADMIN_EMAILS'))
}

/** The address a sign-in is matched against, or `null` when LinkedIn does not vouch for it. */
export function verifiedEmail(identity: { email: string | null; emailVerified: boolean }): string | null {
  if (!identity.emailVerified || !identity.email) return null
  return identity.email.trim().toLowerCase()
}

export function adminEmailAlreadyListed(): DomainError {
  return new DomainError('CONFLICT', 'That email is already on the admin list')
}

export function adminEmailNotListed(): DomainError {
  return new DomainError('NOT_FOUND', 'That email is not on the admin list')
}

export function lastAdminEmail(): DomainError {
  return new DomainError('CONFLICT', 'The last admin email cannot be removed')
}
