import { clamp } from '../motionMath'
import type { PlayerProfile } from './playerProfile'
import type { AppLanguage } from '../i18n/language'

export const GUESTBOOK_MESSAGE_LIMIT = 240

export interface GuestbookEntry {
  id: string
  name: string
  messages: Partial<Record<AppLanguage, string>>
  createdAt: string
  profile: PlayerProfile
}

export function clampGuestbookPage(page: number, entryCount: number) {
  return clamp(page, 0, Math.max(0, entryCount - 1))
}

export function guestbookMessageForLanguage(entry: GuestbookEntry, language: AppLanguage) {
  return entry.messages[language] ?? entry.messages.en ?? entry.messages.ko ?? ''
}
