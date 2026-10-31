import { hexColor, inputRecord, invalidInput, parseFields } from './validation.js'

// Field names mirror frontend/src/data/playerProfile.ts. The frontend owns each field's option catalog and
// normalizes unknown options when rendering, so the backend checks field names and value shape, not every option.
export const characterAppearanceFields = [
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
] as const
export const characterColorFields = ['skin', 'hair', 'hat', 'top', 'bottom', 'shoes'] as const

export type CharacterAppearanceField = (typeof characterAppearanceFields)[number]
export type CharacterColorField = (typeof characterColorFields)[number]

/** How a character looks, in the flat shape of the frontend `PlayerProfile`; residents and guestbook entries use it. */
export type CharacterAppearance = Readonly<
  Record<CharacterAppearanceField, string> & { colors: Readonly<Record<CharacterColorField, string>> }
>

const appearanceOptionPattern = /^[a-z][a-z -]{0,31}$/u
const linkedInProfilePath = /^\/in\/([A-Za-z0-9_%-]{1,100})(?:\/|$)/u

export function parseCharacterAppearance(value: unknown, field: string): CharacterAppearance {
  const input = inputRecord(value, field)
  const colors = inputRecord(input.colors, `${field}.colors`)
  return {
    ...parseFields(input, characterAppearanceFields, (option, name) => appearanceOption(option, `${field}.${name}`)),
    colors: parseFields(colors, characterColorFields, (color, name) => hexColor(color, `${field}.colors.${name}`)),
  }
}

export function appearanceOption(value: unknown, field: string): string {
  if (typeof value !== 'string' || !appearanceOptionPattern.test(value)) {
    throw invalidInput(`${field} must be a lowercase appearance option`)
  }
  return value
}

/**
 * Accepts what the frontend accepts (https linkedin.com profile links, including extra path, query, or hash)
 * and keeps only the canonical profile address, so stored links can only ever point at a LinkedIn profile.
 */
export function linkedInProfileUrl(value: unknown): string | null {
  if (value === undefined || value === null || value === '') return null
  if (typeof value !== 'string' || value.length > 300) {
    throw invalidInput('linkedInProfileUrl must be a LinkedIn profile link')
  }
  const trimmed = value.trim()
  const url = URL.canParse(trimmed) ? new URL(trimmed) : null
  const profileId = url?.pathname.match(linkedInProfilePath)?.[1]
  const linkedInHost = url?.hostname === 'linkedin.com' || url?.hostname === 'www.linkedin.com'
  if (url?.protocol !== 'https:' || !linkedInHost || !profileId || url.username || url.password) {
    throw invalidInput('linkedInProfileUrl must be an https://www.linkedin.com/in/<id> link')
  }
  return `https://www.linkedin.com/in/${profileId}`
}
