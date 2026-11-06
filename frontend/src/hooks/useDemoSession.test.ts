import { describe, expect, it } from 'vitest'
import { CAMERA_DEFAULTS } from '../camera/cameraConfig'
import { InMemoryDemoRepository } from '../data/InMemoryDemoRepository'
import { SAMPLE_TOWN } from '../testing/sampleTown'
import { resetDemoSession } from './useDemoSession'
import { DEFAULT_PLAYER_PROFILE } from '../data/playerProfile'

describe('session reset used by the hook', () => {
  it('removes saved state and returns seed defaults', async () => {
    const repository = new InMemoryDemoRepository(async () => SAMPLE_TOWN)
    await repository.saveSession({
      playerPosition: { x: 10, y: 2, z: 10 },
      camera: { ...CAMERA_DEFAULTS, fov: 60 },
      ui: { instructionsDismissed: true },
      profile: { ...DEFAULT_PLAYER_PROFILE, name: 'Custom', hat: 'cap' },
    })
    const reset = await resetDemoSession(repository, SAMPLE_TOWN)
    expect(await repository.getSession()).toBeNull()
    expect(reset.playerPosition).toEqual(SAMPLE_TOWN.spawn)
    expect(reset.camera).toEqual(CAMERA_DEFAULTS)
    expect(reset.profile).toEqual(DEFAULT_PLAYER_PROFILE)
    expect(reset.ui.instructionsDismissed).toBe(false)
  })
})
