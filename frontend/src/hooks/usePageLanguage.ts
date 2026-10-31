import { useEffect, useState } from 'react'
import { initialLanguage, saveLanguagePreference } from '../data/languagePreference'

/** A page's language: it opens in the one the tab last showed and keeps `<html lang>` and the tab's memory in step. */
export function usePageLanguage() {
  const [language, setLanguage] = useState(initialLanguage)
  useEffect(() => {
    document.documentElement.lang = language
    saveLanguagePreference(language)
  }, [language])
  return [language, setLanguage] as const
}
