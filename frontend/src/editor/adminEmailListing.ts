import { AdminEmailRequestError, type AdminEmail } from '../data/adminEmailsApi'

export type AdminEmailFailure = 'invalid' | 'listed' | 'protected' | 'missing' | 'forbidden' | 'failed'

/** Keeps the list sorted by email, as the backend returns it. */
export function withAdminEmail(admins: AdminEmail[], added: AdminEmail) {
  return [...admins.filter(({ email }) => email !== added.email), added].sort((left, right) =>
    left.email.localeCompare(right.email),
  )
}

/** A 409 means a duplicate when adding, and the admin's own or the last listed email when removing. */
export function adminEmailFailure(error: unknown, action: 'add' | 'remove'): AdminEmailFailure {
  if (!(error instanceof AdminEmailRequestError)) return 'failed'
  if (error.status === 400) return 'invalid'
  if (error.status === 401 || error.status === 403) return 'forbidden'
  if (error.status === 404) return 'missing'
  if (error.status !== 409) return 'failed'
  return action === 'add' ? 'listed' : 'protected'
}

/** The list on screen is out of date when the server says an email is already listed or already gone. */
export function isStaleAdminList(failure: AdminEmailFailure) {
  return failure === 'listed' || failure === 'missing'
}
