import { describe, expect, it } from 'vitest'
import { isBaseballPath } from './baseballRoute'

describe('baseball route', () => {
  it('matches the ballpark page with or without a trailing slash, and nothing beside or below it', () => {
    expect(['/baseball', '/baseball/'].map(isBaseballPath)).toEqual([true, true])
    expect(['/', '/admin', '/baseballs', '/baseball/play'].map(isBaseballPath)).toEqual([false, false, false, false])
  })
})
