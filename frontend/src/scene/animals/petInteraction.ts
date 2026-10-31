import { languageCopy, type AppLanguage } from '../../i18n/language'

export type PetSound = 'bark' | 'pant'

/** `petName` is the town's pet name in `language`. */
export function petResponse(petting: boolean, petName: string, language: AppLanguage) {
  const copy = languageCopy[language].pet
  if (petting) return { sound: 'pant' as const, pettingDuration: 3000, text: copy.petted(petName) }
  return { sound: 'bark' as const, pettingDuration: 0, text: copy.greeted(petName) }
}
