// Shared by the backend API clients: one way to send a request, and the checks that keep a malformed response
// from reaching the page. The backend validates every write; these guard the render boundary.

const acceptJson = { Accept: 'application/json' }

/**
 * The API shares this page's origin, so the session cookie is never offered to any other origin; a public read may
 * leave it off altogether (`credentials: 'omit'`).
 */
export function requestJson(path: string, init: RequestInit = {}, request: typeof fetch = fetch) {
  const headers = init.body === undefined ? acceptJson : { ...acceptJson, 'Content-Type': 'application/json' }
  return request(path, { credentials: 'same-origin', ...init, headers })
}

export async function responseRecord(response: Response) {
  return requireRecord(await response.json(), 'response')
}

export function requireRecord(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label} must be an object`)
  return value as Record<string, unknown>
}

/** For data that falls back to defaults field by field rather than being rejected. */
export function recordOrEmpty(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : {}
}

export function requireList(value: unknown, label: string): unknown[] {
  if (!Array.isArray(value)) throw new Error(`${label} must be an array`)
  return value
}

export function requireText(value: unknown, label: string) {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${label} must be a non-empty string`)
  return value
}
