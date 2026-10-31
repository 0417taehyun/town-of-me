import { describe, expect, it } from 'vitest'
import { DEFAULT_PLAYER_PROFILE } from '../data/playerProfile'
import { creatorValidationError, initialCreatorDraft } from './characterCreatorDraft'

describe('character creator draft', () => {
  it('starts a first-time visitor with a randomized look and a local name but keeps an existing character', () => {
    expect(initialCreatorDraft(DEFAULT_PLAYER_PROFILE, false, 'en', () => 0.99999)).toBe(DEFAULT_PLAYER_PROFILE)
    const english = initialCreatorDraft(DEFAULT_PLAYER_PROFILE, true, 'en', () => 0.99999)
    expect(english.name).toBe('Jesse')
    expect(english.colors.skin).not.toBe(DEFAULT_PLAYER_PROFILE.colors.skin)
    expect(initialCreatorDraft(DEFAULT_PLAYER_PROFILE, true, 'ko', () => 0).name).toBe('민준')
  })

  it('reports the first invalid field in form order', () => {
    const invalid = { ...DEFAULT_PLAYER_PROFILE, genderIdentity: 'self-described' as const, linkedInProfileUrl: 'x' }
    expect(creatorValidationError({ ...invalid, name: ' ' })?.field).toBe('name')
    expect(creatorValidationError(invalid)?.field).toBe('identity')
    expect(creatorValidationError({ ...invalid, genderDescription: 'Me' })?.field).toBe('linkedInProfile')
    expect(creatorValidationError(DEFAULT_PLAYER_PROFILE)).toBeNull()
  })
})
