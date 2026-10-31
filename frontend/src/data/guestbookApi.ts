import type { AppLanguage } from '../i18n/language'
import type { GuestbookEntry } from './guestbook'
import { requestJson, requireList, requireRecord, requireText, responseRecord } from './apiClient'
import { normalizePlayerProfile, profileAppearance, type PlayerProfile } from './playerProfile'

// The wire format of backend/src/guestbook.ts.

export type GuestbookStatus = 'pending' | 'approved'
/** The visitor's latest entry; `revisable` while it is still today's entry. */
export type OwnGuestbookEntry = GuestbookEntry & { status: GuestbookStatus; revisable: boolean }
/** `updatedAt` is the version an approval names, so the admin approves only the text they read. */
export type ReviewedGuestbookEntry = GuestbookEntry & { status: GuestbookStatus; updatedAt: string }

export class GuestbookRequestError extends Error {
  constructor(readonly status: number) {
    super(`Guestbook API returned ${status}`)
    this.name = 'GuestbookRequestError'
  }
}

export function parseStatus(value: unknown): GuestbookStatus {
  if (value !== 'pending' && value !== 'approved') throw new Error('status must be pending or approved')
  return value
}

export function parseEntry(value: unknown, label: string): GuestbookEntry {
  const input = requireRecord(value, label)
  const messages = requireRecord(input.messages, `${label}.messages`)
  const name = requireText(input.name, `${label}.name`)
  const message = (language: AppLanguage) => (typeof messages[language] === 'string' ? messages[language] : undefined)
  return {
    id: requireText(input.id, `${label}.id`),
    name,
    messages: { ko: message('ko'), en: message('en') },
    createdAt: requireText(input.createdAt, `${label}.createdAt`),
    profile: normalizePlayerProfile({ ...requireRecord(input.profile, `${label}.profile`), name }),
  }
}

export function parseOwnEntry(value: unknown, label: string): OwnGuestbookEntry {
  const input = requireRecord(value, label)
  return { ...parseEntry(input, label), status: parseStatus(input.status), revisable: input.revisable === true }
}

export function parseReviewedEntry(value: unknown, index: number): ReviewedGuestbookEntry {
  const label = `entries[${index}]`
  const input = requireRecord(value, label)
  return {
    ...parseEntry(input, label),
    status: parseStatus(input.status),
    updatedAt: requireText(input.updatedAt, `${label}.updatedAt`),
  }
}

export async function send(path: string, init: RequestInit, request: typeof fetch) {
  const response = await requestJson(path, init, request)
  if (!response.ok) throw new GuestbookRequestError(response.status)
  return response
}

/** Approved entries for everyone, plus this browser's own latest entry, which may still be awaiting review. */
export async function fetchGuestbook(request: typeof fetch = fetch) {
  const payload = await responseRecord(await send('/v1/guestbook', {}, request))
  return {
    entries: requireList(payload.entries, 'entries').map((entry, index) => parseEntry(entry, `entries[${index}]`)),
    own: payload.own ? parseOwnEntry(payload.own, 'own') : null,
  }
}

/**
 * Writes a new entry, or revises today's entry when `revisingId` is given. Only the name and how the character
 * looks are sent, never the visitor's gender or LinkedIn link.
 */
export async function writeGuestbookEntry(
  input: { message: string; language: AppLanguage; profile: PlayerProfile },
  revisingId: string | null,
  request: typeof fetch = fetch,
): Promise<OwnGuestbookEntry> {
  const profile = { name: input.profile.name, ...profileAppearance(input.profile) }
  const path = revisingId ? `/v1/guestbook/${encodeURIComponent(revisingId)}` : '/v1/guestbook'
  const body = JSON.stringify({ message: input.message, locale: input.language, profile })
  const response = await send(path, { method: revisingId ? 'PUT' : 'POST', body }, request)
  return parseOwnEntry((await responseRecord(response)).entry, 'entry')
}

export async function fetchGuestbookForReview(request: typeof fetch = fetch): Promise<ReviewedGuestbookEntry[]> {
  const payload = await responseRecord(await send('/v1/admin/guestbook', {}, request))
  return requireList(payload.entries, 'entries').map(parseReviewedEntry)
}

export async function approveGuestbookEntry(
  entry: ReviewedGuestbookEntry,
  request: typeof fetch = fetch,
): Promise<ReviewedGuestbookEntry> {
  const path = `/v1/admin/guestbook/${encodeURIComponent(entry.id)}/approval`
  const response = await send(path, { method: 'POST', body: JSON.stringify({ updatedAt: entry.updatedAt }) }, request)
  return parseReviewedEntry((await responseRecord(response)).entry, 0)
}

export async function deleteGuestbookEntry(id: string, request: typeof fetch = fetch): Promise<void> {
  await send(`/v1/admin/guestbook/${encodeURIComponent(id)}`, { method: 'DELETE' }, request)
}
