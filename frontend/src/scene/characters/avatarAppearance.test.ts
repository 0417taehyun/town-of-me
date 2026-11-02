import { describe, expect, it } from 'vitest'
import {
  appearanceFields,
  DEFAULT_PLAYER_PROFILE,
  GENDER_IDENTITIES,
  normalizePlayerProfile,
  PROFILE_CHOICES,
} from '../../data/playerProfile'
import { getAvatarAppearance } from './avatarAppearance'

describe('shared preview and playable character appearance', () => {
  it('gives every option of each appearance field a distinct rendered appearance', () => {
    appearanceFields.forEach((field) => {
      const appearances = PROFILE_CHOICES[field].options.map((option) =>
        JSON.stringify(getAvatarAppearance(normalizePlayerProfile({ ...DEFAULT_PLAYER_PROFILE, [field]: option }))),
      )
      expect(new Set(appearances).size).toBe(PROFILE_CHOICES[field].options.length)
    })
  })

  it('keeps face options independent and part identifiers unique', () => {
    const base = getAvatarAppearance(DEFAULT_PLAYER_PROFILE)
    const changed = getAvatarAppearance({
      ...DEFAULT_PLAYER_PROFILE,
      eyes: 'happy',
      nose: 'wide',
      mouth: 'grin',
      mustache: 'curled',
      ears: 'pointed',
    })
    expect(changed.top).toBe(base.top)
    expect(new Set(changed.headParts.map((part) => part.id)).size).toBe(changed.headParts.length)
    expect(getAvatarAppearance({ ...DEFAULT_PLAYER_PROFILE, name: 'New name' })).toEqual(base)
  })

  it('does not change the rendered body, face or clothing for any gender identity', () => {
    GENDER_IDENTITIES.forEach((identity) =>
      expect(
        getAvatarAppearance({ ...DEFAULT_PLAYER_PROFILE, genderIdentity: identity, genderDescription: 'Any identity' }),
      ).toEqual(getAvatarAppearance(DEFAULT_PLAYER_PROFILE)),
    )
  })
})
