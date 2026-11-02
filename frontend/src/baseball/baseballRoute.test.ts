import { describe, expect, it, vi } from 'vitest'
import type { SessionUser } from '../data/adminSession'
import { ballparkOpens, isBaseballPath, isNextRulesPreview, NEXT_RULES_PREVIEW_PATH } from './baseballRoute'

const signedIn = (role: SessionUser['role']) => vi.fn(async () => ({ id: 'user', displayName: 'Robin', role }))

describe('baseball route', () => {
  it('matches the ballpark page with or without a trailing slash, and nothing beside or below it', () => {
    expect(['/baseball', '/baseball/'].map(isBaseballPath)).toEqual([true, true])
    expect(['/', '/admin', '/baseballs', '/baseball/play'].map(isBaseballPath)).toEqual([false, false, false, false])
  })

  it("previews next month's rules only when the query asks for them, as the editor's link does", () => {
    const editorLink = new URL(NEXT_RULES_PREVIEW_PATH, 'https://town.example')
    expect(isBaseballPath(editorLink.pathname) && isNextRulesPreview(editorLink.search)).toBe(true)
    expect(isNextRulesPreview('?lang=ko&rules=next')).toBe(true)
    expect(['', '?rules=current', '?rules=nextmonth', '?rule=next'].map(isNextRulesPreview)).toEqual([
      false,
      false,
      false,
      false,
    ])
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
