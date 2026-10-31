import { describe, expect, it } from 'vitest'
import { getPreferredLanguage } from './language'

describe('preferred UI language', () => {
  it('uses the first supported browser preference and falls back to English', () => {
    expect(getPreferredLanguage(['ko-KR', 'en-US'])).toBe('ko')
    expect(getPreferredLanguage(['fr-FR', 'en-GB', 'ko-KR'])).toBe('en')
    expect(getPreferredLanguage(['fr-FR'])).toBe('en')
  })
})
