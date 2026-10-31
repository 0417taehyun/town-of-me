import type { TreeVariant } from '../objects/variants'

export type Season = 'spring' | 'summer' | 'autumn' | 'winter'

export function getSeason(date: Date): Season {
  const month = date.getMonth()
  if (month >= 2 && month <= 4) return 'spring'
  if (month >= 5 && month <= 7) return 'summer'
  if (month >= 8 && month <= 10) return 'autumn'
  return 'winter'
}

// Tree crowns are lit and tone-mapped, so their colors run a little more saturated than they read at noon.
export const seasonPalettes = {
  spring: {
    ground: '#91bd87',
    distantGround: '#82a97b',
    hills: '#76a38b',
    hedge: '#65a06d',
    distantCrown: '#4f9e61',
    treeCrowns: ['#39be63', '#69d357', '#90d94a', '#eb93a9'],
    treeTops: ['#74dc78', '#a3eb6b', '#bdeb5c', '#ffbac7'],
  },
  summer: {
    ground: '#82b77a',
    distantGround: '#779b70',
    hills: '#668f78',
    hedge: '#52875d',
    distantCrown: '#327e50',
    treeCrowns: ['#11994f', '#27b35d', '#0f8748', '#4ac35c'],
    treeTops: ['#2fca69', '#52d473', '#24b85a', '#71d970'],
  },
  autumn: {
    ground: '#a9ad72',
    distantGround: '#8f9567',
    hills: '#8b9272',
    hedge: '#778a58',
    distantCrown: '#b45b2d',
    treeCrowns: ['#e3492f', '#f7901a', '#ce223c', '#e9671c', '#b27210'],
    treeTops: ['#ffc230', '#f95d2d', '#fb9a21', '#e04032', '#f6b029'],
  },
  winter: {
    // Dormant grass, seen only where the snow has not settled yet or is melting away.
    ground: '#a3ad8c',
    distantGround: '#c3d3d0',
    hills: '#8e9f9b',
    hedge: '#708774',
    distantCrown: '#527c73',
    treeCrowns: ['#368771', '#489980', '#2c786d', '#62a594'],
    treeTops: ['#74b5a0', '#66af94', '#56a493', '#8bc1af'],
  },
} satisfies Record<
  Season,
  {
    ground: string
    distantGround: string
    hills: string
    hedge: string
    distantCrown: string
    treeCrowns: string[]
    treeTops: string[]
  }
>

/** One palette entry for every season, such as each season's ground color. */
export function getSeasonColors(entry: 'ground' | 'distantGround' | 'hills' | 'hedge' | 'distantCrown') {
  const { spring, summer, autumn, winter } = seasonPalettes
  return {
    spring: spring[entry],
    summer: summer[entry],
    autumn: autumn[entry],
    winter: winter[entry],
  } satisfies Record<Season, string>
}

/** `seed`, a hash of the tree's id, picks its crown color; a blossoming tree wears the last, blossom color in spring. */
export function getSeasonTreeColor(season: Season, seed: number, variant: TreeVariant, top = false) {
  const colors = top ? seasonPalettes[season].treeTops : seasonPalettes[season].treeCrowns
  if (season !== 'spring') return colors[seed % colors.length]
  if (variant === 'blossoming') return colors[colors.length - 1]
  // A leafy tree whose seed lands on the blossom color takes the first leaf color instead.
  return colors[(seed % colors.length) % (colors.length - 1)]
}

/** Blossoms falling in spring follow the tree's variant; falling leaves and snow caps are scattered by `seed`. */
export function hasSeasonalTreeEffect(season: Season, seed: number, variant: TreeVariant) {
  if (season === 'spring') return variant === 'blossoming'
  if (season === 'autumn') return seed % 4 === 1 || seed % 8 === 0
  if (season === 'winter') return seed % 3 === 0
  return false
}
