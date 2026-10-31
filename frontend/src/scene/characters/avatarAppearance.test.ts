import { describe, expect, it } from 'vitest'
import {
  appearanceFields,
  colorFields,
  DEFAULT_PLAYER_PROFILE,
  GENDER_IDENTITIES,
  normalizePlayerProfile,
  PROFILE_CHOICES,
} from '../../data/playerProfile'
import { getAvatarAppearance } from './avatarAppearance'

describe('shared preview and playable character appearance', () => {
  it.each(appearanceFields)('gives every %s option a distinct rendered appearance', (field) => {
    const appearances = PROFILE_CHOICES[field].options.map((option) =>
      JSON.stringify(getAvatarAppearance(normalizePlayerProfile({ ...DEFAULT_PLAYER_PROFILE, [field]: option }))),
    )
    expect(new Set(appearances).size).toBe(PROFILE_CHOICES[field].options.length)
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

  it.each(colorFields)('applies custom %s color to actual geometry/material data', (field) => {
    const profile = { ...DEFAULT_PLAYER_PROFILE, hat: 'cap' as const }
    const appearance = getAvatarAppearance({ ...profile, colors: { ...profile.colors, [field]: '#123abc' } })
    expect(JSON.stringify(appearance)).toContain('#123abc')
    expect(appearance).not.toEqual(getAvatarAppearance(profile))
  })

  it.each(GENDER_IDENTITIES)('does not change the rendered body, face or clothing for %s identity', (identity) => {
    expect(
      getAvatarAppearance({ ...DEFAULT_PLAYER_PROFILE, genderIdentity: identity, genderDescription: 'Any identity' }),
    ).toEqual(getAvatarAppearance(DEFAULT_PLAYER_PROFILE))
  })
})
