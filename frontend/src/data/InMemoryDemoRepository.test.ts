import { describe, expect, it } from 'vitest'
import { CAMERA_DEFAULTS } from '../camera/cameraConfig'
import type { DemoRepository } from './DemoRepository'
import { InMemoryDemoRepository } from './InMemoryDemoRepository'
import { DEFAULT_PLAYER_PROFILE } from './playerProfile'

const noTown = () => Promise.reject(new Error('These tests load no town'))

const session = {
  playerPosition: { x: 1, y: 2, z: 3 },
  camera: { ...CAMERA_DEFAULTS },
  ui: { instructionsDismissed: true },
}

describe('InMemoryDemoRepository', () => {
  it('restores a visitor from session storage after a page reload', async () => {
    const values = new Map<string, string>()
    const sessionStore = {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
      removeItem: (key: string) => void values.delete(key),
    }
    await new InMemoryDemoRepository(noTown, sessionStore).saveSession(session)
    expect(await new InMemoryDemoRepository(noTown, sessionStore).getSession()).toEqual({
      ...session,
      profile: DEFAULT_PLAYER_PROFILE,
    })
  })

  it("resumes a guide saved at the pet step's old name instead of stalling on an unknown step", async () => {
    const stored = JSON.stringify({ ...session, ui: { instructionsDismissed: true, guideStep: 'toto' } })
    const sessionStore = { getItem: () => stored, setItem: () => undefined, removeItem: () => undefined }
    const restored = await new InMemoryDemoRepository(noTown, sessionStore).getSession()
    expect(restored?.ui.guideStep).toBe('pet')
  })

  it('round-trips a customized profile and migrates a legacy session without a profile', async () => {
    const repository: DemoRepository = new InMemoryDemoRepository(noTown)
    const profile = {
      ...DEFAULT_PLAYER_PROFILE,
      name: '  Mira  ',
      hat: 'sunhat' as const,
      eyes: 'happy' as const,
      colors: { ...DEFAULT_PLAYER_PROFILE.colors, skin: '#583c30' },
      genderIdentity: 'non-binary' as const,
    }
    await repository.saveSession({ ...session, profile })
    profile.name = 'Changed outside repository'
    profile.colors.skin = '#abcdef'
    const loaded = await repository.getSession()
    expect(loaded!.profile).toEqual({ ...profile, name: 'Mira', colors: { ...profile.colors, skin: '#583c30' } })
    loaded!.profile!.name = 'Changed read value'
    loaded!.profile!.colors.top = '#abcdef'
    expect((await repository.getSession())!.profile!.name).toBe('Mira')
    expect((await repository.getSession())!.profile!.colors.top).toBe(DEFAULT_PLAYER_PROFILE.colors.top)
    await repository.saveSession(session)
    expect((await repository.getSession())!.profile).toEqual(DEFAULT_PLAYER_PROFILE)
  })

  it('returns independent values and resets sessions', async () => {
    const repository: DemoRepository = new InMemoryDemoRepository(noTown)
    await repository.saveSession(session)
    const loaded = await repository.getSession()
    loaded!.playerPosition.x = 99
    expect((await repository.getSession())!.playerPosition.x).toBe(1)
    await repository.resetSession()
    expect(await repository.getSession()).toBeNull()
  })
})
