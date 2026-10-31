import { describe, expect, it } from 'vitest'
import { isBaseballPath, isNextRulesPreview, NEXT_RULES_PREVIEW_PATH } from './baseballRoute'

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
})
