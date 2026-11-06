import type { DemoRepository } from './DemoRepository'
import type { DemoSession, TownSnapshot } from './models'
import { normalizePlayerProfile } from './playerProfile'
import { normalizeGuideStep } from './townGuide'

export type TownLoader = (townId: string) => Promise<TownSnapshot>
type SessionStore = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>

export function sessionStorageKey(townId: string) {
  return `town-of-me:${townId}`
}

export function getBrowserSessionStore(): SessionStore | null {
  if (typeof window === 'undefined') return null
  try {
    return window.sessionStorage
  } catch {
    return null
  }
}

/** Throws on malformed JSON; `readStoredSession` treats that as no saved session. */
export function parseStoredSession(stored: string | null, townId: string): DemoSession | null {
  if (!stored) return null
  const session = JSON.parse(stored) as DemoSession
  if (session.townId !== townId) return null
  const ui = { ...session.ui, guideStep: normalizeGuideStep(session.ui.guideStep) }
  return { ...session, ui, profile: normalizePlayerProfile(session.profile) }
}

export function readStoredSession(sessionStore: SessionStore | null, townId: string) {
  if (!sessionStore) return null
  try {
    return parseStoredSession(sessionStore.getItem(sessionStorageKey(townId)), townId)
  } catch {
    return null
  }
}

export function clearStoredSession(sessionStore: SessionStore | null, townId: string) {
  try {
    sessionStore?.removeItem(sessionStorageKey(townId))
  } catch {
    // Nothing else to reset when browser storage is unavailable.
  }
}

export class InMemoryDemoRepository implements DemoRepository {
  private readonly sessions = new Map<string, DemoSession>()

  constructor(
    private readonly townLoader: TownLoader,
    private readonly sessionStore: SessionStore | null = getBrowserSessionStore(),
  ) {}

  async getTown(townId: string): Promise<TownSnapshot> {
    return structuredClone(await this.townLoader(townId))
  }

  async getSession(townId: string): Promise<DemoSession | null> {
    const stored = readStoredSession(this.sessionStore, townId)
    if (stored) return structuredClone(stored)
    const session = this.sessions.get(townId)
    return session ? structuredClone(session) : null
  }

  async saveSession(session: DemoSession): Promise<void> {
    const normalized = structuredClone({ ...session, profile: normalizePlayerProfile(session.profile) })
    this.sessions.set(session.townId, normalized)
    try {
      this.sessionStore?.setItem(sessionStorageKey(session.townId), JSON.stringify(normalized))
    } catch {
      // The in-memory session still keeps the current visit working.
    }
  }

  async resetSession(townId: string): Promise<void> {
    this.sessions.delete(townId)
    clearStoredSession(this.sessionStore, townId)
  }
}
