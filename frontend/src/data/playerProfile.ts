import { recordOrEmpty } from './apiClient'
import { normalizeLinkedInProfileUrl } from './linkedInProfile'

export const PROFILE_CHOICES = {
  hat: { label: 'Hat', options: ['none', 'cap', 'beanie', 'sunhat'] },
  eyes: { label: 'Eyes', options: ['round', 'oval', 'happy'] },
  nose: { label: 'Nose', options: ['button', 'small', 'wide'] },
  mouth: { label: 'Mouth', options: ['smile', 'grin', 'quiet'] },
  mustache: { label: 'Mustache', options: ['none', 'pencil', 'curled'] },
  ears: { label: 'Ears', options: ['round', 'small', 'pointed'] },
  hair: { label: 'Hair', options: ['crop', 'curls', 'bob', 'none'] },
  top: { label: 'Top', options: ['tee', 'sweater', 'shirt'] },
  bottom: { label: 'Bottom', options: ['trousers', 'shorts', 'relaxed trousers'] },
  shoes: { label: 'Shoes', options: ['sneakers', 'boots'] },
} as const

const clothingPalette = [
  ['Sage', '#6f987c'],
  ['Coral', '#ca7765'],
  ['Blue', '#638fab'],
  ['Cream', '#ece3cc'],
  ['Navy', '#374b65'],
  ['Plum', '#79647c'],
  ['Gold', '#d8b879'],
  ['Red', '#ad514a'],
] as const
export const COLOR_CHOICES = {
  skin: {
    label: 'Skin',
    presets: [
      ['Porcelain', '#f5dcc5'],
      ['Peach', '#e9ba99'],
      ['Golden', '#c9935f'],
      ['Warm', '#bc885f'],
      ['Brown', '#8c5d43'],
      ['Deep', '#583c30'],
    ],
  },
  hair: {
    label: 'Hair',
    presets: [
      ['Brown', '#503a2e'],
      ['Black', '#272525'],
      ['Blond', '#d6b779'],
      ['Ginger', '#a75838'],
      ['Silver', '#d2cfcb'],
      ['Violet', '#886da6'],
    ],
  },
  hat: { label: 'Hat', presets: clothingPalette },
  top: { label: 'Top', presets: clothingPalette },
  bottom: { label: 'Bottom', presets: clothingPalette },
  shoes: { label: 'Shoes', presets: clothingPalette },
} as const
export type ColorField = keyof typeof COLOR_CHOICES
export type PlayerColors = Record<ColorField, string>
export const colorFields = Object.keys(COLOR_CHOICES) as ColorField[]
export const GENDER_IDENTITIES = ['prefer not to say', 'woman', 'man', 'non-binary', 'self-described'] as const
export type GenderIdentity = (typeof GENDER_IDENTITIES)[number]
export type AppearanceField = keyof typeof PROFILE_CHOICES
export type PlayerProfile = {
  name: string
  genderIdentity: GenderIdentity
  genderDescription: string
  linkedInProfileUrl: string
  colors: PlayerColors
} & {
  [Field in AppearanceField]: (typeof PROFILE_CHOICES)[Field]['options'][number]
}

export const appearanceFields = [
  'hair',
  'hat',
  'eyes',
  'ears',
  'nose',
  'mouth',
  'mustache',
  'top',
  'bottom',
  'shoes',
] as const satisfies readonly AppearanceField[]
export const DEFAULT_PLAYER_PROFILE: PlayerProfile = {
  name: 'Visitor',
  genderIdentity: 'prefer not to say',
  genderDescription: '',
  linkedInProfileUrl: '',
  hat: 'none',
  eyes: 'round',
  nose: 'button',
  mouth: 'smile',
  mustache: 'none',
  ears: 'round',
  hair: 'crop',
  top: 'tee',
  bottom: 'trousers',
  shoes: 'sneakers',
  colors: { skin: '#bc885f', hair: '#503a2e', hat: '#638fab', top: '#6f987c', bottom: '#374b65', shoes: '#ece3cc' },
}

export function trimPlayerName(name: string) {
  return name.trim().replace(/\s+/gu, ' ')
}

export function playerNameError(name: string) {
  if (!trimPlayerName(name)) return 'Please enter a name.'
  if (/\p{Cc}/u.test(name)) return 'Use a name without control characters or line breaks.'
  if (Array.from(trimPlayerName(name)).length > 24) return 'Please use 24 characters or fewer.'
  return null
}

export function genderDescriptionError(identity: GenderIdentity, description: string) {
  if (identity !== 'self-described') return null
  if (!trimPlayerName(description)) return 'Describe your identity, or choose prefer not to say.'
  if (/\p{Cc}/u.test(description) || Array.from(trimPlayerName(description)).length > 48)
    return 'Use up to 48 characters without line breaks.'
  return null
}

export function isPlayerColor(value: unknown): value is string {
  return typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value)
}

/** How the character looks, without who the visitor is: what a guestbook entry or a resident stores. */
export function profileAppearance(profile: PlayerProfile) {
  return {
    ...Object.fromEntries(appearanceFields.map((field) => [field, profile[field]])),
    colors: { ...profile.colors },
  }
}

export function normalizePlayerProfile(value: unknown): PlayerProfile {
  const input = recordOrEmpty(value)
  const choices = Object.fromEntries(
    appearanceFields.map((field) => {
      const inputChoice = input[field]
      const valid = (PROFILE_CHOICES[field].options as readonly unknown[]).includes(inputChoice)
      return [field, valid ? inputChoice : DEFAULT_PLAYER_PROFILE[field]]
    }),
  )
  const inputColors = recordOrEmpty(input.colors)
  const colors = Object.fromEntries(
    colorFields.map((field) => [
      field,
      isPlayerColor(inputColors[field]) ? inputColors[field].toLowerCase() : DEFAULT_PLAYER_PROFILE.colors[field],
    ]),
  ) as PlayerColors
  const name =
    typeof input.name === 'string' && !playerNameError(input.name)
      ? trimPlayerName(input.name)
      : DEFAULT_PLAYER_PROFILE.name
  const identity = (GENDER_IDENTITIES as readonly unknown[]).includes(input.genderIdentity)
    ? (input.genderIdentity as GenderIdentity)
    : 'prefer not to say'
  const description = typeof input.genderDescription === 'string' ? input.genderDescription : ''
  const genderIdentity = genderDescriptionError(identity, description) ? 'prefer not to say' : identity
  const linkedInProfileUrl = normalizeLinkedInProfileUrl(input.linkedInProfileUrl) ?? ''
  return {
    ...DEFAULT_PLAYER_PROFILE,
    ...choices,
    name,
    colors,
    genderIdentity,
    genderDescription: genderIdentity === 'self-described' ? trimPlayerName(description) : '',
    linkedInProfileUrl,
  }
}

export function pickRandom<Value>(options: readonly Value[], random: () => number = Math.random) {
  return options[Math.min(options.length - 1, Math.floor(random() * options.length))]
}

export function randomizePlayerAppearance(profile: PlayerProfile, random: () => number = Math.random): PlayerProfile {
  const pick = <Value>(options: readonly Value[]) => pickRandom(options, random)
  const choices = Object.fromEntries(
    appearanceFields.map((field) => [field, pick(PROFILE_CHOICES[field].options as readonly string[])]),
  )
  const colors = Object.fromEntries(
    colorFields.map((field) => [
      field,
      random() < 0.75
        ? pick<readonly [string, string]>(COLOR_CHOICES[field].presets)[1]
        : `#${Math.floor(random() * 0x1000000)
            .toString(16)
            .padStart(6, '0')}`,
    ]),
  ) as PlayerColors
  return { ...profile, ...choices, colors }
}
