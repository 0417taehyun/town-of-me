import { describe, expect, it, vi } from 'vitest'
import type { SessionUser } from '../data/adminSession'
import {
  ballparkOpens,
  baseballPreview,
  CURRENT_RULES_PREVIEW_PATH,
  isBaseballPath,
  NEXT_RULES_PREVIEW_PATH,
} from './baseballRoute'

const signedIn = (role: SessionUser['role']) => vi.fn(async () => ({ id: 'user', displayName: 'Robin', role }))

describe('baseball route', () => {
  it('matches the ballpark page with or without a trailing slash, and nothing beside or below it', () => {
    expect(['/baseball', '/baseball/'].map(isBaseballPath)).toEqual([true, true])
    expect(['/', '/admin', '/baseballs', '/baseball/play'].map(isBaseballPath)).toEqual([false, false, false, false])
  })

  it("previews next month's rules or this month's only when the query asks, as the editor's links do", () => {
    const links = [NEXT_RULES_PREVIEW_PATH, CURRENT_RULES_PREVIEW_PATH].map(
      (path) => new URL(path, 'https://town.example'),
    )
    expect(links.map((link) => isBaseballPath(link.pathname) && baseballPreview(link.search))).toEqual([
      'next',
      'current',
    ])
    expect(baseballPreview('?lang=ko&rules=next')).toBe('next')
    expect(['', '?rules=nextmonth', '?rule=next'].map(baseballPreview)).toEqual([null, null, null])
  })

  it('opens a hidden ballpark only for a signed-in admin on the preview, asking who is signed in only then', async () => {
    const admin = signedIn('admin')
    expect(await ballparkOpens({ visible: false }, false, admin)).toBe(false)
    expect(await ballparkOpens({ visible: true }, false, admin)).toBe(true)
    expect(admin).not.toHaveBeenCalled()
    expect(await ballparkOpens({ visible: false }, true, signedIn('admin'))).toBe(true)
    const others = [signedIn('member'), vi.fn(async () => null), vi.fn(() => Promise.reject(new Error('502')))]
    const opened = await Promise.all(others.map((sessionUser) => ballparkOpens({ visible: false }, true, sessionUser)))
    expect(opened).toEqual([false, false, false])
  })
})
