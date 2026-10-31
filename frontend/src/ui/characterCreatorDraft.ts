import { linkedInProfileUrlError } from '../data/linkedInProfile'
import {
  genderDescriptionError,
  pickRandom,
  playerNameError,
  randomizePlayerAppearance,
  type PlayerProfile,
} from '../data/playerProfile'
import type { AppLanguage } from '../i18n/language'

const suggestedNames = {
  en: ['Alex', 'Jamie', 'Sam', 'Taylor', 'Jordan', 'Casey', 'Riley', 'Morgan', 'Avery', 'Robin', 'Cameron', 'Jesse'],
  ko: ['민준', '서준', '도윤', '지호', '하준', '서연', '지우', '하윤', '수아', '유진', '민서', '지민'],
} satisfies Record<AppLanguage, readonly string[]>

/** A first-time visitor starts from a random look and a suggested name; a returning one keeps their character. */
export function initialCreatorDraft(
  profile: PlayerProfile,
  firstEntry: boolean,
  language: AppLanguage,
  random: () => number = Math.random,
) {
  if (!firstEntry) return profile
  const name = pickRandom(suggestedNames[language], random)
  return randomizePlayerAppearance({ ...profile, name }, random)
}

export type CreatorField = 'name' | 'identity' | 'linkedInProfile'

/** The first field the visitor must fix, in the order the form shows them. */
export function creatorValidationError(draft: PlayerProfile): { field: CreatorField; error: string } | null {
  const nameError = playerNameError(draft.name)
  if (nameError) return { field: 'name', error: nameError }
  const identityError = genderDescriptionError(draft.genderIdentity, draft.genderDescription)
  if (identityError) return { field: 'identity', error: identityError }
  const profileUrlError = linkedInProfileUrlError(draft.linkedInProfileUrl)
  return profileUrlError ? { field: 'linkedInProfile', error: profileUrlError } : null
}
