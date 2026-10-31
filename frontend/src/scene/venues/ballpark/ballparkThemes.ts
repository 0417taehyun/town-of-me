import type { BallparkColorRole, BallparkSettings, BallparkTheme } from '../../../data/models'

// Ballpark themes are data: a new theme is an id in BALLPARK_THEMES (data/models.ts) and a palette here. Grass, hedges,
// trees, and flowers are not in a palette: they follow the visitor's season like the town's (scene/environment).

/**
 * What a theme colors: the four building roles an admin may override (walls and stands, roofs and awnings, trim, and
 * the accent of flags and signs), and the dirt and chalk, which keep the theme's colors so the field reads as a field
 * in every season.
 */
export type BallparkPalette = Record<BallparkColorRole, string> & { dirt: string; lines: string }

export const BALLPARK_THEME_PALETTES = {
  garden: {
    walls: '#ece3cc',
    roof: '#ca7765',
    trim: '#f8f3e7',
    accent: '#d8b879',
    dirt: '#cf9f70',
    lines: '#f8f3e7',
  },
} satisfies Record<BallparkTheme, BallparkPalette>

/** The theme's palette with the admin's color for each building role they override. */
export function resolveBallparkPalette(ballpark: Pick<BallparkSettings, 'theme' | 'colors'>): BallparkPalette {
  const theme = BALLPARK_THEME_PALETTES[ballpark.theme]
  const { colors } = ballpark
  return {
    ...theme,
    walls: colors.walls ?? theme.walls,
    roof: colors.roof ?? theme.roof,
    trim: colors.trim ?? theme.trim,
    accent: colors.accent ?? theme.accent,
  }
}
