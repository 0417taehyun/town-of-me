import { describe, expect, it } from 'vitest'
import { DEFAULT_PLAYER_PROFILE, type PlayerProfile } from '../../data/playerProfile'
import { pickLooks } from './guestLooks'

const guest = (name: string, top: string): PlayerProfile => ({
  ...DEFAULT_PLAYER_PROFILE,
  name,
  linkedInProfileUrl: 'https://www.linkedin.com/in/example',
  colors: { ...DEFAULT_PLAYER_PROFILE.colors, top },
})

describe('the looks of the people around the play', () => {
  const approved = [guest('Fern', '#111111'), guest('Moss', '#222222'), guest('Reed', '#333333')]

  it('uses every approved look once before random ones, the same each visit, and never a name', () => {
    const looks = pickLooks(approved, 8, 7)
    const tops = looks.map((look) => look.colors.top)
    expect(tops.slice(0, 3).sort()).toEqual(['#111111', '#222222', '#333333'])
    expect(looks.slice(3).some((look) => approved.some(({ colors }) => colors.top === look.colors.top))).toBe(false)
    expect(pickLooks(approved, 8, 7)).toEqual(looks)
    expect(looks.every((look) => look.name === DEFAULT_PLAYER_PROFILE.name && look.linkedInProfileUrl === '')).toBe(
      true,
    )
  })

  it('picks different approved looks when there are more of them than places', () => {
    const tops = pickLooks(approved, 2, 3).map((look) => look.colors.top)
    expect(new Set(tops).size).toBe(2)
  })
})
