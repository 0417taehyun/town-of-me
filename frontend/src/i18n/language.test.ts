import { afterEach, describe, expect, it, vi } from 'vitest'
import { getPreferredLanguage, monthName } from './language'

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

describe('month names', () => {
  it('names the month itself west of UTC, and adds the year only when it differs from the current one', () => {
    vi.stubEnv('TZ', 'America/Los_Angeles')
    expect(monthName('2026-12', '2026-11', 'en')).toBe('December')
    expect(monthName('2027-01', '2026-12', 'en')).toBe('January 2027')
    expect(monthName('2027-01', '2026-12', 'ko')).toBe('2027년 1월')
  })
})
