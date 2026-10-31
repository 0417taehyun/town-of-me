import { describe, expect, it } from 'vitest'
import { clampGuestbookPage, guestbookMessageForLanguage, type GuestbookEntry } from './guestbook'
import { DEFAULT_PLAYER_PROFILE } from './playerProfile'

const entry: GuestbookEntry = {
  id: 'maple-welcome',
  name: 'Maple',
  messages: { en: 'The fountain is lovely.', ko: '분수대가 정말 예뻐요.' },
  createdAt: '2026-10-03T18:30:00.000Z',
  profile: DEFAULT_PLAYER_PROFILE,
}

describe('guestbook pages', () => {
  it('keeps page navigation inside the available notes', () => {
    expect(clampGuestbookPage(-1, 3)).toBe(0)
    expect(clampGuestbookPage(8, 3)).toBe(2)
    expect(clampGuestbookPage(2, 0)).toBe(0)
  })

  it('uses the preferred translation and falls back when the backend returns one language', () => {
    expect(guestbookMessageForLanguage(entry, 'ko')).toContain('분수대')
    expect(guestbookMessageForLanguage(entry, 'en')).toContain('fountain')
    expect(guestbookMessageForLanguage({ ...entry, messages: { en: 'English only' } }, 'ko')).toBe('English only')
  })
})
