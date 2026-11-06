import type { VisitorSession } from './models'
import { normalizePlayerProfile } from './playerProfile'
import { normalizeGuideStep } from './townGuide'

type SessionStore = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>

const SESSION_STORAGE_KEY = 'town-of-me-session'

export function getBrowserSessionStore(): SessionStore | null {
  if (typeof window === 'undefined') return null
  try {
    return window.sessionStorage
  } catch {
    return null
  }
}

/** Throws on malformed JSON; `readStoredSession` treats that as no saved session. */
export function parseStoredSession(stored: string | null): VisitorSession | null {
  if (!stored) return null
  const session = JSON.parse(stored) as VisitorSession
  const ui = { ...session.ui, guideStep: normalizeGuideStep(session.ui.guideStep) }
  return { ...session, ui, profile: normalizePlayerProfile(session.profile) }
}

export function readStoredSession(sessionStore: SessionStore | null) {
  if (!sessionStore) return null
  try {
    return parseStoredSession(sessionStore.getItem(SESSION_STORAGE_KEY))
  } catch {
    return null
  }
}

export function saveStoredSession(sessionStore: SessionStore | null, session: VisitorSession) {
  const normalized = { ...session, profile: normalizePlayerProfile(session.profile) }
  try {
    sessionStore?.setItem(SESSION_STORAGE_KEY, JSON.stringify(normalized))
  } catch {
    // The page's state still keeps the current visit working.
  }
}

export function clearStoredSession(sessionStore: SessionStore | null) {
  try {
    sessionStore?.removeItem(SESSION_STORAGE_KEY)
  } catch {
    // Nothing else to reset when browser storage is unavailable.
  }
}
