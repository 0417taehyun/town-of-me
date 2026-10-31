import type { Actor } from './domain.js'
import { DomainError } from './domain.js'

/**
 * The town, its residents, and guestbook moderation belong to the owner. The admin role is read from the
 * database on every request, so this check never trusts a role carried by the client.
 */
export function assertAdmin(actor: Actor): asserts actor is Extract<Actor, { kind: 'linked' }> {
  if (actor.kind !== 'linked') throw new DomainError('AUTH_REQUIRED', 'LinkedIn sign-in is required')
  if (actor.role !== 'admin') throw new DomainError('FORBIDDEN', 'Administrator access is required')
}
