import { parseCharacterAppearance, type CharacterAppearance } from './character.js'
import { DomainError, locales, type Locale } from './domain.js'
import { inputRecord, multilineText, oneOf, singleLineText } from './validation.js'

const messageLimit = 240
/** A visitor may leave one entry per day and revise it during that day. */
export const guestbookWritingWindowMs = 24 * 60 * 60 * 1000

/** How the visitor's character looked when signing; gender and the LinkedIn link stay out of entries. */
export type GuestbookAppearance = CharacterAppearance & Readonly<{ name: string }>

/** Entries stay hidden from other visitors until the admin approves them, and a revision needs approval again. */
export type GuestbookStatus = 'pending' | 'approved'

export interface GuestbookEntry {
  id: string
  /** Hash of the anonymous visitor cookie, so the same browser can find and revise its own entry. */
  visitorHash: string
  appearance: GuestbookAppearance
  message: string
  locale: Locale
  status: GuestbookStatus
  createdAt: string
  updatedAt: string
}

export type GuestbookInput = Pick<GuestbookEntry, 'appearance' | 'message' | 'locale'>

export function parseGuestbookInput(value: Record<string, unknown>): GuestbookInput {
  const profile = inputRecord(value.profile, 'profile')
  return {
    appearance: {
      ...parseCharacterAppearance(profile, 'profile'),
      name: singleLineText(profile.name, 'profile.name', 24),
    },
    message: multilineText(value.message, 'message', messageLimit),
    locale: oneOf(value.locale, locales, 'locale'),
  }
}

/** Another visitor's entry is reported exactly like a missing one, so entry ids reveal nothing about their writers. */
export function guestbookEntryNotFound(): DomainError {
  return new DomainError('NOT_FOUND', 'Guestbook entry not found')
}

/** Whether `entry` is still the visitor's entry for today, which they revise instead of writing another. */
export function isRevisable(entry: GuestbookEntry, now: number): boolean {
  return now - Date.parse(entry.createdAt) < guestbookWritingWindowMs
}

/** The frontend `GuestbookEntry` shape. */
export function publicGuestbookEntry(entry: GuestbookEntry) {
  return {
    id: entry.id,
    name: entry.appearance.name,
    messages: { [entry.locale]: entry.message },
    createdAt: entry.createdAt,
    profile: entry.appearance,
  }
}

/** The visitor's own entry, with whether it is visible yet and whether today's entry can still be revised. */
export function ownGuestbookEntry(entry: GuestbookEntry, now: number) {
  return { ...publicGuestbookEntry(entry), status: entry.status, revisable: isRevisable(entry, now) }
}

/** `updatedAt` is what an approval must name, so the admin only ever approves the text they read. */
export function reviewedGuestbookEntry(entry: GuestbookEntry) {
  return { ...publicGuestbookEntry(entry), status: entry.status, updatedAt: entry.updatedAt }
}
