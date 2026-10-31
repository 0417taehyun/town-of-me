import { requestJson, requireRecord, responseRecord } from './apiClient'
import { isLinkedInHttpsUrl } from './linkedInProfile'

export type SessionUser = { id: string; displayName: string; role: 'member' | 'admin' }

/** The backend reads the role from the database on every request; this only decides which admin screen to show. */
export async function getSessionUser(request: typeof fetch = fetch): Promise<SessionUser | null> {
  const response = await requestJson('/v1/me', {}, request)
  if (!response.ok) throw new Error(`Current user API returned ${response.status}`)
  const payload = await responseRecord(response)
  if (!payload.user) return null
  const user = requireRecord(payload.user, 'Current user')
  if (typeof user.id !== 'string' || typeof user.displayName !== 'string') throw new Error('Current user is invalid')
  return { id: user.id, displayName: user.displayName, role: user.role === 'admin' ? 'admin' : 'member' }
}

export async function beginLinkedInLogin(request: typeof fetch = fetch) {
  const response = await requestJson('/v1/auth/linkedin/start', {}, request)
  if (!response.ok) throw new Error(`LinkedIn login API returned ${response.status}`)
  const payload = await responseRecord(response)
  if (typeof payload.authorizationUrl !== 'string') throw new Error('LinkedIn authorization URL is missing')
  const authorizationUrl = new URL(payload.authorizationUrl)
  if (!isLinkedInHttpsUrl(authorizationUrl)) throw new Error('LinkedIn authorization URL is invalid')
  return authorizationUrl.toString()
}

export async function signOut(request: typeof fetch = fetch) {
  const response = await requestJson('/v1/auth/logout', { method: 'POST' }, request)
  if (!response.ok) throw new Error(`Logout API returned ${response.status}`)
}
