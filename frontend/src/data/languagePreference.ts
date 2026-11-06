import { getPreferredLanguage, type AppLanguage } from '../i18n/language'
import { getBrowserSessionStore } from './InMemoryDemoRepository'

type LanguageStore = Pick<Storage, 'getItem' | 'setItem'>

export const LANGUAGE_PREFERENCE_KEY = 'town-of-me-language'

/**
 * The language a page opens in: the one the tab last showed, so the town and the ballpark agree across a full page
 * load, else the browser's. A value this build does not know, or storage the browser blocks, falls back too.
 */
export function initialLanguage(
  store: LanguageStore | null = getBrowserSessionStore(),
  languages: readonly string[] = navigator.languages,
): AppLanguage {
  return readLanguagePreference(store) ?? getPreferredLanguage(languages)
}

export function readLanguagePreference(store: LanguageStore | null): AppLanguage | null {
  try {
    const stored = store?.getItem(LANGUAGE_PREFERENCE_KEY)
    return stored === 'en' || stored === 'ko' ? stored : null
  } catch {
    return null
  }
}

export function saveLanguagePreference(language: AppLanguage, store: LanguageStore | null = getBrowserSessionStore()) {
  try {
    store?.setItem(LANGUAGE_PREFERENCE_KEY, language)
  } catch {
    // The page keeps its language; only the next page falls back to the browser's.
  }
}
