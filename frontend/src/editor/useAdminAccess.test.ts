import { describe, expect, it, vi } from 'vitest'
import { beginLinkedInLogin, getSessionUser } from '../data/adminSession'
import { getAdminAccessStatus, isAdminPath } from './useAdminAccess'
import { getSaveFailureNotice } from './useTownEditor'
import { TownSaveError } from '../data/townApi'

describe('admin access', () => {
  it('opens the editor only on /admin', () => {
    expect(isAdminPath('/admin')).toBe(true)
    expect(isAdminPath('/admin/')).toBe(true)
    expect(isAdminPath('/')).toBe(false)
    expect(isAdminPath('/administrator')).toBe(false)
  })

  it('shows the editor only for a session the backend reports as admin', () => {
    const admin = { id: 'u', displayName: 'Robin', role: 'admin' as const }
    expect(getAdminAccessStatus(false, 0, null)).toBe('disabled')
    expect(getAdminAccessStatus(true, 1, { attempt: 0, user: admin, failed: false })).toBe('checking')
    expect(getAdminAccessStatus(true, 0, { attempt: 0, user: null, failed: false })).toBe('signed-out')
    expect(getAdminAccessStatus(true, 0, { attempt: 0, user: { ...admin, role: 'member' }, failed: false })).toBe(
      'not-admin',
    )
    expect(getAdminAccessStatus(true, 0, { attempt: 0, user: null, failed: true })).toBe('error')
    expect(getAdminAccessStatus(true, 0, { attempt: 0, user: admin, failed: false })).toBe('admin')
  })

  it('reads the role from the session API and treats anything else as a member', async () => {
    const request = vi.fn(async () =>
      Response.json({ user: { id: 'u', displayName: 'Visitor', role: 'superuser', residencyStatus: 'pending' } }),
    )
    expect(await getSessionUser(request as typeof fetch)).toEqual({ id: 'u', displayName: 'Visitor', role: 'member' })
    const signedOut = vi.fn(async () => Response.json({ user: null }))
    expect(await getSessionUser(signedOut as typeof fetch)).toBeNull()
  })

  it('only follows LinkedIn authorization URLs', async () => {
    const linkedIn = vi.fn(async () =>
      Response.json({ authorizationUrl: 'https://www.linkedin.com/oauth/v2/authorization?state=s' }),
    )
    expect(await beginLinkedInLogin(linkedIn as typeof fetch)).toContain('https://www.linkedin.com/oauth/')
    const elsewhere = vi.fn(async () => Response.json({ authorizationUrl: 'https://example.com/oauth' }))
    await expect(beginLinkedInLogin(elsewhere as typeof fetch)).rejects.toThrow('invalid')
  })

  it('explains each save failure', () => {
    expect(getSaveFailureNotice(new TownSaveError(409))).toBe('conflict')
    expect(getSaveFailureNotice(new TownSaveError(401))).toBe('forbidden')
    expect(getSaveFailureNotice(new TownSaveError(403))).toBe('forbidden')
    expect(getSaveFailureNotice(new TownSaveError(400))).toBe('invalid')
    expect(getSaveFailureNotice(new TownSaveError(500))).toBe('error')
    expect(getSaveFailureNotice(new TypeError('Failed to fetch'))).toBe('error')
  })
})
