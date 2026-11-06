import { useEffect, useState } from 'react'
import { initialLanguage, saveLanguagePreference } from '../data/languagePreference'
import type { AppLanguage } from '../i18n/language'

/** A page's language: it opens in the one the tab last showed and keeps `<html lang>` and the tab's memory in step. */
export function usePageLanguage(initial: () => AppLanguage = initialLanguage) {
  const [language, setLanguage] = useState(initial)
  useEffect(() => {
    document.documentElement.lang = language
    saveLanguagePreference(language)
  }, [language])
  return [language, setLanguage] as const
}
