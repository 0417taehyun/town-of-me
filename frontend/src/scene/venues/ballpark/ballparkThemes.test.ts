import { describe, expect, it } from 'vitest'
import { BALLPARK_COLOR_ROLES } from '../../../data/models'
import { BALLPARK_THEME_PALETTES, type BallparkPalette, resolveBallparkPalette } from './ballparkThemes'

function changedKeys(palette: BallparkPalette) {
  const theme: BallparkPalette = BALLPARK_THEME_PALETTES.garden
  return (Object.keys(theme) as (keyof BallparkPalette)[]).filter((key) => palette[key] !== theme[key])
}

describe('ballpark palette', () => {
  it("keeps the theme's colors without overrides, and an override changes only its own role", () => {
    expect(changedKeys(resolveBallparkPalette({ theme: 'garden', colors: {} }))).toEqual([])
    BALLPARK_COLOR_ROLES.forEach((role) => {
      const palette = resolveBallparkPalette({ theme: 'garden', colors: { [role]: '#123456' } })
      expect(changedKeys(palette)).toEqual([role])
      expect(palette[role]).toBe('#123456')
    })
  })
})
