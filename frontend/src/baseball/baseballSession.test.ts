import { describe, expect, it } from 'vitest'
import { CAMERA_DEFAULTS } from '../camera/cameraConfig'
import { DEFAULT_PLAYER_PROFILE } from '../data/playerProfile'
import { createSeedSession, createVisitorSession } from '../hooks/useVisitorSession'
import { SAMPLE_TOWN } from '../testing/sampleTown'
import { needsCharacter, withVenueProfile } from './baseballSession'

const madeCharacter = { ...DEFAULT_PLAYER_PROFILE, colors: { ...DEFAULT_PLAYER_PROFILE.colors, hat: '#ad514a' } }

describe('baseball session', () => {
  it('asks for a character only from a visitor who has neither made one nor entered the town', () => {
    const seed = createSeedSession(SAMPLE_TOWN)
    expect(needsCharacter(seed)).toBe(true)
    expect(needsCharacter({ ...seed, profile: madeCharacter })).toBe(false)
    expect(needsCharacter({ ...seed, profile: { ...DEFAULT_PLAYER_PROFILE, name: 'Mika' } })).toBe(false)
    const entered = createVisitorSession(SAMPLE_TOWN.spawn, CAMERA_DEFAULTS, DEFAULT_PLAYER_PROFILE, 'move')
    expect(needsCharacter(entered)).toBe(false)
  })

  it('saves the character without moving the visitor, resetting their camera, or skipping the town entry', () => {
    const seed = createSeedSession(SAMPLE_TOWN)
    const session = {
      ...seed,
      playerPosition: { x: 3, y: 1.2, z: -7 },
      camera: { ...CAMERA_DEFAULTS, fov: 60 },
      ui: { instructionsDismissed: false, guideStep: 'glance' as const },
    }
    const saved = withVenueProfile(session, madeCharacter)
    expect(saved).toEqual({ ...session, profile: madeCharacter })
    expect(needsCharacter(saved)).toBe(false)
  })
})
