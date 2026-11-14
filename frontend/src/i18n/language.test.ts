import { afterEach, describe, expect, it, vi } from 'vitest'
import { getPreferredLanguage, weekName } from './language'

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('preferred UI language', () => {
  it('uses the first supported browser preference and falls back to English', () => {
    expect(getPreferredLanguage(['ko-KR', 'en-US'])).toBe('ko')
    expect(getPreferredLanguage(['fr-FR', 'en-GB', 'ko-KR'])).toBe('en')
    expect(getPreferredLanguage(['fr-FR'])).toBe('en')
  })
})

describe('week names', () => {
  it('names the week by its KST days west of UTC, with the year only when a day is outside the current one', () => {
    vi.stubEnv('TZ', 'America/Los_Angeles')
    // Browsers and Node space the dash differently, so only the days and the dash are compared.
    const spaced = (text: string) => text.replace(/\s+/gu, ' ')
    expect(spaced(weekName('2026-11-09', '2026-11-16', 'en'))).toBe('Nov 9 – 15')
    expect(spaced(weekName('2026-11-30', '2026-11-09', 'ko'))).toBe('11월 30일~12월 6일')
    expect(spaced(weekName('2026-12-28', '2026-12-28', 'en'))).toBe('Dec 28, 2026 – Jan 3, 2027')
    expect(spaced(weekName('2026-12-21', '2027-01-04', 'ko'))).toBe('2026년 12월 21일~27일')
  })
})
