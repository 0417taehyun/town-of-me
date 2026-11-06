import type { DemoRepository } from './DemoRepository'
import type { DemoSession, TownSnapshot } from './models'
import { normalizePlayerProfile } from './playerProfile'
import { normalizeGuideStep } from './townGuide'

export type TownLoader = () => Promise<TownSnapshot>
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
export function parseStoredSession(stored: string | null): DemoSession | null {
  if (!stored) return null
  const session = JSON.parse(stored) as DemoSession
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

export function clearStoredSession(sessionStore: SessionStore | null) {
  try {
    sessionStore?.removeItem(SESSION_STORAGE_KEY)
  } catch {
    // Nothing else to reset when browser storage is unavailable.
  }
}

export class InMemoryDemoRepository implements DemoRepository {
  private session: DemoSession | null = null

  constructor(
    private readonly townLoader: TownLoader,
    private readonly sessionStore: SessionStore | null = getBrowserSessionStore(),
  ) {}

  async getTown(): Promise<TownSnapshot> {
    return structuredClone(await this.townLoader())
  }

  async getSession(): Promise<DemoSession | null> {
    return structuredClone(readStoredSession(this.sessionStore) ?? this.session)
  }

  async saveSession(session: DemoSession): Promise<void> {
    const normalized = structuredClone({ ...session, profile: normalizePlayerProfile(session.profile) })
    this.session = normalized
    try {
      this.sessionStore?.setItem(SESSION_STORAGE_KEY, JSON.stringify(normalized))
    } catch {
      // The in-memory session still keeps the current visit working.
    }
  }

  async resetSession(): Promise<void> {
    this.session = null
    clearStoredSession(this.sessionStore)
  }
}
