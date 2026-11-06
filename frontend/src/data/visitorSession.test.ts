import { describe, expect, it } from 'vitest'
import { CAMERA_DEFAULTS } from '../camera/cameraConfig'
import { DEFAULT_PLAYER_PROFILE } from './playerProfile'
import { clearStoredSession, readStoredSession, saveStoredSession } from './visitorSession'

const session = {
  playerPosition: { x: 1, y: 2, z: 3 },
  camera: { ...CAMERA_DEFAULTS },
  ui: { instructionsDismissed: true },
}

function memoryStore() {
  const values = new Map<string, string>()
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => void values.delete(key),
  }
}

describe('visitor session', () => {
  it('restores a visitor from session storage after a page reload, until it is cleared', () => {
    const store = memoryStore()
    expect(readStoredSession(store)).toBeNull()
    saveStoredSession(store, session)
    expect(readStoredSession(store)).toEqual({ ...session, profile: DEFAULT_PLAYER_PROFILE })
    clearStoredSession(store)
    expect(readStoredSession(store)).toBeNull()
  })

  it("resumes a guide saved at the pet step's old name instead of stalling on an unknown step", () => {
    const stored = JSON.stringify({ ...session, ui: { instructionsDismissed: true, guideStep: 'toto' } })
    const store = { ...memoryStore(), getItem: () => stored }
    expect(readStoredSession(store)?.ui.guideStep).toBe('pet')
  })

  it('round-trips a customized profile and migrates a legacy session without a profile', () => {
    const store = memoryStore()
    const profile = {
      ...DEFAULT_PLAYER_PROFILE,
      name: '  Mira  ',
      hat: 'sunhat' as const,
      eyes: 'happy' as const,
      colors: { ...DEFAULT_PLAYER_PROFILE.colors, skin: '#583c30' },
      genderIdentity: 'non-binary' as const,
    }
    saveStoredSession(store, { ...session, profile })
    expect(readStoredSession(store)?.profile).toEqual({ ...profile, name: 'Mira' })
    saveStoredSession(store, session)
    expect(readStoredSession(store)?.profile).toEqual(DEFAULT_PLAYER_PROFILE)
  })

  it('treats a malformed session or blocked storage as no session, without throwing', () => {
    expect(readStoredSession({ ...memoryStore(), getItem: () => '{not json' })).toBeNull()
    const blocked = {
      getItem: () => {
        throw new Error('blocked')
      },
      setItem: () => {
        throw new Error('blocked')
      },
      removeItem: () => {
        throw new Error('blocked')
      },
    }
    expect(readStoredSession(blocked)).toBeNull()
    expect(() => saveStoredSession(blocked, session)).not.toThrow()
    expect(() => clearStoredSession(blocked)).not.toThrow()
  })
})
