import { describe, expect, it } from 'vitest'
import {
  appearanceFields,
  colorFields,
  DEFAULT_PLAYER_PROFILE,
  GENDER_IDENTITIES,
  genderDescriptionError,
  isPlayerColor,
  normalizePlayerProfile,
  playerNameError,
  PROFILE_CHOICES,
  randomizePlayerAppearance,
  trimPlayerName,
} from './playerProfile'

describe('player profile boundary', () => {
  it.each([undefined, null, {}, 'legacy', { name: '', hat: 'unknown', eyes: 3 }])(
    'migrates missing or invalid fields to defaults: %s',
    (input) => {
      const result = normalizePlayerProfile(input)
      expect(result).toEqual(DEFAULT_PLAYER_PROFILE)
      expect(result).not.toBe(DEFAULT_PLAYER_PROFILE)
    },
  )

  it('trims names and preserves valid independent choices without unknown fields', () => {
    expect(
      normalizePlayerProfile({ name: '  반가운   이웃  ', eyes: 'happy', mouth: 'quiet', hat: 'sunhat', extra: true }),
    ).toEqual({ ...DEFAULT_PLAYER_PROFILE, name: '반가운 이웃', eyes: 'happy', mouth: 'quiet', hat: 'sunhat' })
    expect(trimPlayerName('  Pat   Lee  ')).toBe('Pat Lee')
  })

  it('validates blank, control-character and overlong names, counting Unicode code points', () => {
    expect(playerNameError('   ')).toBeTruthy()
    expect(playerNameError('A\nB')).toBeTruthy()
    expect(playerNameError('A\u0000B')).toBeTruthy()
    expect(playerNameError('🌱'.repeat(24))).toBeNull()
    expect(playerNameError('🌱'.repeat(25))).toBeTruthy()
    expect(normalizePlayerProfile({ name: 'x'.repeat(25) }).name).toBe(DEFAULT_PLAYER_PROFILE.name)
  })

  it('accepts only six-digit hex colors, copies the color map, and discards malformed values', () => {
    const input = { ...DEFAULT_PLAYER_PROFILE, colors: { ...DEFAULT_PLAYER_PROFILE.colors, hair: '#A0B1C2' } }
    const normalized = normalizePlayerProfile(input)
    expect(normalized.colors.hair).toBe('#a0b1c2')
    expect(normalized.colors).not.toBe(input.colors)
    expect(isPlayerColor('#123abc')).toBe(true)
    expect(isPlayerColor('red')).toBe(false)
    expect(normalizePlayerProfile({ top: { toString: null }, colors: { skin: {} } })).toEqual(DEFAULT_PLAYER_PROFILE)
    expect(
      normalizePlayerProfile({
        skin: 'constructor',
        colors: { skin: 'url(http://example.test)', hat: '#fff', shoes: 0 },
      }).colors,
    ).toEqual(DEFAULT_PLAYER_PROFILE.colors)
  })

  it.each(GENDER_IDENTITIES)('stores optional %s identity independently of all appearance fields', (identity) => {
    const profile = normalizePlayerProfile({
      ...DEFAULT_PLAYER_PROFILE,
      genderIdentity: identity,
      genderDescription: '  My   identity  ',
    })
    expect(profile.genderIdentity).toBe(identity)
    expect(profile.genderDescription).toBe(identity === 'self-described' ? 'My identity' : '')
    expect(profile.colors).toEqual(DEFAULT_PLAYER_PROFILE.colors)
    appearanceFields.forEach((field) => expect(profile[field]).toBe(DEFAULT_PLAYER_PROFILE[field]))
  })

  it('validates self-description and safely defaults absent or malformed identity metadata', () => {
    expect(genderDescriptionError('self-described', '')).toBeTruthy()
    expect(genderDescriptionError('self-described', 'x'.repeat(49))).toBeTruthy()
    expect(genderDescriptionError('self-described', 'A\nB')).toBeTruthy()
    expect(genderDescriptionError('self-described', '🌱'.repeat(48))).toBeNull()
    expect(genderDescriptionError('prefer not to say', '')).toBeNull()
    expect(normalizePlayerProfile({ genderIdentity: 'invalid' }).genderIdentity).toBe('prefer not to say')
    expect(normalizePlayerProfile({ genderIdentity: 'self-described', genderDescription: '' }).genderIdentity).toBe(
      'prefer not to say',
    )
  })

  it('randomizes only appearance with injected RNG, including custom colors, without mutating identity or source', () => {
    const profile = normalizePlayerProfile({
      name: 'Mira',
      genderIdentity: 'self-described',
      genderDescription: 'My identity',
      linkedInProfileUrl: 'https://www.linkedin.com/in/mira',
    })
    const first = randomizePlayerAppearance(profile, () => 0)
    const last = randomizePlayerAppearance(profile, () => 0.99999)
    expect(first.name).toBe('Mira')
    expect(last.genderIdentity).toBe('self-described')
    expect(last.genderDescription).toBe('My identity')
    expect(last.linkedInProfileUrl).toBe('https://www.linkedin.com/in/mira')
    appearanceFields.forEach((field) => {
      expect(first[field]).toBe(PROFILE_CHOICES[field].options[0])
      expect(last[field]).toBe(PROFILE_CHOICES[field].options.at(-1))
    })
    colorFields.forEach((field) => expect(isPlayerColor(last.colors[field])).toBe(true))
    expect(normalizePlayerProfile(last)).toEqual(last)
    expect(profile.colors).toEqual(DEFAULT_PLAYER_PROFILE.colors)
    expect(first.colors).not.toBe(profile.colors)
  })
})
