// The painted statue's look (leaderboard spec §6.5): the visitor's town character in its own colors, finished like a
// glossy vinyl figure, on a round trophy pedestal. Gold, silver, and bronze say the place, in the pedestal's broad band
// and rim, the plaque's star, and the rosette; the pedestal's height says it again, and only the champion lifts a cup.
// The board's statues use it now, and the town's statues by the ballpark gate will.

export type StatueRank = 1 | 2 | 3

export const STATUE_RANKS: readonly StatueRank[] = [1, 2, 3]

/**
 * A place's finish. The metal never follows a theme, so gold always means first. `ribbon` is the rosette's matte satin,
 * `emblem` the metal a shade deeper so the plaque's star reads on its pale enamel, `bodyHeight` the pedestal's, and
 * the figure sways `swayDegrees` either way over `swaySeconds`.
 */
export const RANK_FINISHES: Record<StatueRank, RankFinish> = {
  1: {
    metal: '#e9c46c',
    roughness: 0.24,
    ribbon: '#e7c47c',
    sparkle: '#fff0bf',
    emblem: '#c39635',
    bodyHeight: 0.64,
    swayDegrees: 7,
    swaySeconds: 8,
  },
  2: {
    metal: '#cdd5dc',
    roughness: 0.2,
    ribbon: '#c4cfd9',
    sparkle: '#f4f8fc',
    emblem: '#8794a3',
    bodyHeight: 0.5,
    swayDegrees: 5,
    swaySeconds: 9,
  },
  3: {
    metal: '#c47a52',
    roughness: 0.3,
    ribbon: '#d9997a',
    sparkle: '#ffdcc4',
    emblem: '#a65a35',
    bodyHeight: 0.38,
    swayDegrees: 5,
    swaySeconds: 10,
  },
}

export type RankFinish = {
  metal: string
  roughness: number
  ribbon: string
  sparkle: string
  emblem: string
  bodyHeight: number
  swayDegrees: number
  swaySeconds: number
}

/** The pedestal's body, its plinth, and the plaque's enamel: the colors a ballpark theme may one day change. */
export const PEDESTAL_COLORS = { pedestal: '#ece3cc', plinth: '#d6c9ad', plaque: '#f7f0e1' }

/** Pedestal measurements (statue units). `band` is the metal stripe under the top rim. */
export const PEDESTAL = {
  radius: 0.72,
  plinthRadius: 0.84,
  plinthHeight: 0.08,
  plaqueWidth: 0.66,
  plaqueHeight: 0.15,
  band: 0.085,
}

/** The figure's height on its pedestal; the town character is 2.1 tall. */
export const FIGURE_HEIGHT = 1.75
export const TOWN_CHARACTER_HEIGHT = 2.1

/** A vinyl figure: a little gloss and a faint studio reflection over its own colors; ink eyes get a hard clearcoat. */
export const FIGURE_FINISH = { roughness: 0.45, envMapIntensity: 0.35 }
export const EYE_FINISH = { roughness: 0.3, clearcoat: 1, clearcoatRoughness: 0.1, envMapIntensity: 0.6 }

/** An anonymous record's default batter, in one palette blue: the same figure for every such record. */
export const DEFAULT_BATTER_COLOR = '#638fab'

/** An empty pedestal holds a pale plaster figure instead of a person. */
export const PLASTER = { color: '#e9e2d2', opacity: 0.35 }

/** Twinkles round each figure, in pedestal-top space (x, y, z, size); the champion's crowd round the raised cup. */
export const SPARKLE_SPOTS: Record<StatueRank, [number, number, number, number][]> = {
  1: [
    [-0.86, 1.9, 0.3, 0.2],
    [-0.28, 2.05, 0.25, 0.12],
    [-0.98, 1.36, 0.25, 0.1],
    [0.74, 1.62, 0.3, 0.15],
    [0.42, 2.0, 0.2, 0.09],
    [0.86, 0.95, 0.35, 0.1],
    [-0.58, 0.5, 0.5, 0.08],
  ],
  2: [
    [0.62, 0.66, 0.45, 0.13],
    [-0.8, 1.72, 0.25, 0.11],
    [0.78, 1.66, 0.3, 0.1],
    [0.2, 2.02, 0.2, 0.07],
  ],
  3: [
    [-0.62, 0.66, 0.45, 0.12],
    [0.8, 1.62, 0.3, 0.09],
    [-0.78, 1.66, 0.3, 0.08],
  ],
}
