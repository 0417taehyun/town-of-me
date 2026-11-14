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
  it('matches the ballpark page and its board with or without a trailing slash, and nothing beside or below them', () => {
    expect(['/baseball', '/baseball/', '/baseball/ranking', '/baseball/ranking/'].map(isBaseballPath)).toEqual([
      true,
      true,
      true,
      true,
    ])
    const others = ['/', '/admin', '/baseballs', '/baseball/play', '/baseball/rankings', '/baseball/ranking/2026-10']
    expect(others.map(isBaseballPath)).toEqual([false, false, false, false, false, false])
  })

  it("previews next week's rules or this week's only when the query asks, as the editor's links do", () => {
    const links = [NEXT_RULES_PREVIEW_PATH, CURRENT_RULES_PREVIEW_PATH].map(
      (path) => new URL(path, 'https://town.example'),
    )
    expect(links.map((link) => isBaseballPath(link.pathname) && baseballPreview(link.search))).toEqual([
      'next',
      'current',
    ])
    expect(baseballPreview('?lang=ko&rules=next')).toBe('next')
    expect(['', '?rules=nextweek', '?rule=next'].map(baseballPreview)).toEqual([null, null, null])
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
