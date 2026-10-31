import { describe, expect, it, vi } from 'vitest'
import { approveGuestbookEntry, fetchGuestbook, GuestbookRequestError, writeGuestbookEntry } from './guestbookApi'
import { DEFAULT_PLAYER_PROFILE } from './playerProfile'

const wireEntry = {
  id: '4d6f2b8e-6a51-4c11-9c87-0d2f5d7f3a10',
  name: 'Maple',
  messages: { ko: '분수대가 예뻐요' },
  createdAt: '2026-10-24T00:00:00.000Z',
  profile: { name: 'Maple', hair: 'bob', colors: { skin: '#e9ba99' } },
}

describe('guestbook API boundary', () => {
  it('reads approved entries and this browser’s own entry with its review status', async () => {
    const request = vi.fn(async () =>
      Response.json({ entries: [wireEntry], own: { ...wireEntry, status: 'pending', revisable: true } }),
    )
    const { entries, own } = await fetchGuestbook(request as typeof fetch)
    expect(entries[0]).toMatchObject({ name: 'Maple', messages: { ko: '분수대가 예뻐요' } })
    expect(entries[0].profile.hair).toBe('bob')
    expect(own).toMatchObject({ status: 'pending', revisable: true })
    expect(request).toHaveBeenCalledWith('/v1/guestbook', expect.objectContaining({ credentials: 'same-origin' }))
  })

  it('writes a new entry or revises today’s, sending only the name and appearance', async () => {
    const request = vi.fn(async () => Response.json({ entry: { ...wireEntry, status: 'pending', revisable: true } }))
    const profile = { ...DEFAULT_PLAYER_PROFILE, genderIdentity: 'woman' as const, linkedInProfileUrl: 'x' }
    await writeGuestbookEntry({ message: 'Hi', language: 'en', profile }, null, request as typeof fetch)
    await writeGuestbookEntry({ message: 'Hi again', language: 'en', profile }, wireEntry.id, request as typeof fetch)
    const [created, revised] = request.mock.calls as unknown as Array<[string, RequestInit]>
    expect(created[0]).toBe('/v1/guestbook')
    expect(created[1].method).toBe('POST')
    expect(revised[0]).toBe(`/v1/guestbook/${wireEntry.id}`)
    expect(revised[1].method).toBe('PUT')
    const body = JSON.parse(String(created[1].body)) as { locale: string; profile: Record<string, unknown> }
    expect(body.locale).toBe('en')
    expect(body.profile).toMatchObject({ name: 'Visitor', hair: DEFAULT_PLAYER_PROFILE.hair })
    expect(body.profile).not.toHaveProperty('genderIdentity')
    expect(body.profile).not.toHaveProperty('linkedInProfileUrl')
  })

  it('surfaces the status of refused writes and approvals', async () => {
    const written = vi.fn(async () => Response.json({ error: { code: 'CONFLICT' } }, { status: 409 }))
    await expect(
      writeGuestbookEntry(
        { message: 'Hi', language: 'en', profile: DEFAULT_PLAYER_PROFILE },
        null,
        written as typeof fetch,
      ),
    ).rejects.toEqual(new GuestbookRequestError(409))
    const stale = vi.fn(async () => Response.json({ error: { code: 'CONFLICT' } }, { status: 409 }))
    const reviewed = { ...wireEntry, messages: {}, profile: DEFAULT_PLAYER_PROFILE, status: 'pending' as const }
    await expect(
      approveGuestbookEntry({ ...reviewed, updatedAt: wireEntry.createdAt }, stale as typeof fetch),
    ).rejects.toEqual(new GuestbookRequestError(409))
    expect(stale.mock.calls[0]).toEqual([
      `/v1/admin/guestbook/${wireEntry.id}/approval`,
      expect.objectContaining({ method: 'POST', body: JSON.stringify({ updatedAt: wireEntry.createdAt }) }),
    ])
  })
})
