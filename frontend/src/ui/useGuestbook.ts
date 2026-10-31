import { useCallback } from 'react'
import { fetchGuestbook, writeGuestbookEntry } from '../data/guestbookApi'
import type { PlayerProfile } from '../data/playerProfile'
import { useRetryableLoad } from '../hooks/useRetryableLoad'
import type { AppLanguage } from '../i18n/language'

/** Loads the board on every open, so a visitor sees their entry's review status as it is now. */
export function useGuestbook() {
  const { status, latest, retry, update } = useRetryableLoad(fetchGuestbook)
  const own = latest?.own ?? null
  const write = useCallback(
    async (message: string, language: AppLanguage, profile: PlayerProfile) => {
      const entry = await writeGuestbookEntry({ message, language, profile }, own?.revisable ? own.id : null)
      update((current) => ({ ...current, own: entry }))
    },
    [own, update],
  )
  return { status, entries: status === 'ready' ? (latest?.entries ?? []) : [], own, retry, write }
}
