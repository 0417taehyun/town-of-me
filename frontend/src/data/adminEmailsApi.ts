import { requestJson, requireList, requireRecord, requireText, responseRecord } from './apiClient'

// The wire format of the backend's /v1/admin/admins routes.

/** An address on the admin list; a verified LinkedIn sign-in with it gets the admin role. `current` marks the
 * signed-in admin's own address, which the backend refuses to remove. */
export type AdminEmail = { email: string; createdAt: string; current: boolean }

export class AdminEmailRequestError extends Error {
  constructor(readonly status: number) {
    super(`Admin email API returned ${status}`)
    this.name = 'AdminEmailRequestError'
  }
}

export function parseAdminEmail(value: unknown, label: string, currentEmail: unknown = null): AdminEmail {
  const input = requireRecord(value, label)
  const email = requireText(input.email, `${label}.email`)
  return { email, createdAt: requireText(input.createdAt, `${label}.createdAt`), current: email === currentEmail }
}

export async function sendAdminEmailRequest(path: string, init: RequestInit, request: typeof fetch) {
  const response = await requestJson(path, init, request)
  if (!response.ok) throw new AdminEmailRequestError(response.status)
  return response
}

/** Sorted by email. */
export async function fetchAdminEmails(request: typeof fetch = fetch): Promise<AdminEmail[]> {
  const payload = await responseRecord(await sendAdminEmailRequest('/v1/admin/admins', {}, request))
  return requireList(payload.admins, 'admins').map((admin, index) =>
    parseAdminEmail(admin, `admins[${index}]`, payload.currentEmail),
  )
}

/** The account with this email becomes an admin at its next sign-in. */
export async function addAdminEmail(email: string, request: typeof fetch = fetch): Promise<AdminEmail> {
  const body = JSON.stringify({ email })
  const response = await sendAdminEmailRequest('/v1/admin/admins', { method: 'POST', body }, request)
  return parseAdminEmail((await responseRecord(response)).admin, 'admin')
}

/** Every account with this email loses the admin role and is signed out at once. */
export async function removeAdminEmail(email: string, request: typeof fetch = fetch): Promise<void> {
  await sendAdminEmailRequest(`/v1/admin/admins/${encodeURIComponent(email)}`, { method: 'DELETE' }, request)
}
