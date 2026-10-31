import { describe, expect, it } from 'vitest'
import { initialLanguage, readLanguagePreference, saveLanguagePreference } from './languagePreference'

function memoryStore() {
  const values = new Map<string, string>()
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
  }
}

const blockedStore = {
  getItem: () => {
    throw new DOMException('blocked', 'SecurityError')
  },
  setItem: () => {
    throw new DOMException('blocked', 'SecurityError')
  },
}

describe('language preference', () => {
  it('opens the next page in the language the tab showed, over the browser language', () => {
    const store = memoryStore()
    expect(initialLanguage(store, ['ko-KR'])).toBe('ko')
    saveLanguagePreference('en', store)
    expect(initialLanguage(store, ['ko-KR'])).toBe('en')
  })

  it('ignores a stored language this build does not know', () => {
    const store = memoryStore()
    store.setItem('town-of-me-language', 'fr')
    expect(readLanguagePreference(store)).toBeNull()
    expect(initialLanguage(store, ['ko'])).toBe('ko')
  })

  it('falls back to the browser language when storage is blocked, without throwing on save', () => {
    expect(readLanguagePreference(blockedStore)).toBeNull()
    expect(() => saveLanguagePreference('ko', blockedStore)).not.toThrow()
    expect(initialLanguage(blockedStore, ['en-US'])).toBe('en')
  })
})
