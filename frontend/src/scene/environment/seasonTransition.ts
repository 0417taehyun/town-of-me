import { Color } from 'three'
import type { Season } from './season'
import { lerp, smoothstep } from '../../motionMath'

/** Seconds after a season change. */
export type SeasonWindow = Readonly<{ start: number; end: number }>

/** When each layer of the town changes, so one season hands over to the next in a believable order. */
export type SeasonTimeline = Readonly<{
  /** Tree crowns take the new colors, each tree at its own moment. */
  foliage: SeasonWindow
  /** Grass, weeds, hedges, and hills take the new colors. */
  ground: SeasonWindow
  /** Snow settles on the ground, roofs, and tree tops, or melts off them. */
  snowCover: SeasonWindow
  /** The old season's petals, leaves, or snowflakes stop falling. */
  particlesOut: SeasonWindow
  /** The new season's petals, leaves, or snowflakes start falling. */
  particlesIn: SeasonWindow
  /** The trees shed their leaves or petals all at once; `null` when nothing falls. */
  leafDrop: SeasonWindow | null
  /** Shed leaves lie on the ground until then, so snow can bury them. */
  leavesRestUntil: number
  end: number
}>

export type SeasonChange = Readonly<{
  from: Season
  to: Season
  /** Seconds on `seasonClock`; minus infinity for the season the town opened in, which needs no transition. */
  startedAt: number
  timeline: SeasonTimeline
  /** How much snow lay on the town when the change began, so an interrupted snowfall or melt continues from there. */
  snowFrom: number
}>

export const span = (start: number, end: number): SeasonWindow => ({ start, end })

export function withEnd(windows: Omit<SeasonTimeline, 'end'>): SeasonTimeline {
  const { foliage, ground, snowCover, particlesOut, particlesIn, leafDrop, leavesRestUntil } = windows
  const ends = [foliage, ground, snowCover, particlesOut, particlesIn, leafDrop ?? foliage].map(({ end }) => end)
  return { ...windows, end: Math.max(...ends, leafDrop ? leavesRestUntil + 1.5 : 0) }
}

const steadyTimeline = withEnd({
  foliage: span(0, 0),
  ground: span(0, 0),
  snowCover: span(0, 0),
  particlesOut: span(0, 0),
  particlesIn: span(0, 0),
  leafDrop: null,
  leavesRestUntil: 0,
})

// Reduced motion keeps the color and snow changes but drops the falling leaves and lets everything fade together.
const gentleTimeline = withEnd({
  foliage: span(0, 1.2),
  ground: span(0, 1.2),
  snowCover: span(0, 1.2),
  particlesOut: span(0, 1.2),
  particlesIn: span(0, 1.2),
  leafDrop: null,
  leavesRestUntil: 0,
})

// The trees let go of their leaves first; snow starts once the leaves are down and slowly buries them.
const intoWinter = withEnd({
  foliage: span(0.3, 4),
  ground: span(3.5, 9),
  snowCover: span(4, 10),
  particlesOut: span(0, 1.2),
  particlesIn: span(2.6, 5.5),
  leafDrop: span(0, 3.6),
  leavesRestUntil: 7,
})

// Snow stops first and melts in patches; only then do the grass and the new leaves come back.
const outOfWinter = withEnd({
  foliage: span(4, 8.5),
  ground: span(1.5, 7.5),
  snowCover: span(0.8, 7),
  particlesOut: span(0, 2),
  particlesIn: span(7.5, 9.5),
  leafDrop: null,
  leavesRestUntil: 0,
})

export function betweenGreenSeasons(from: Season, to: Season): SeasonTimeline {
  // Summer turning to autumn is the slow one: trees blush one by one instead of shedding anything.
  const foliage = from === 'summer' && to === 'autumn' ? span(0, 6.5) : span(0.4, 4.4)
  const leafDrop = from === 'summer' ? null : span(0, 3.2)
  return withEnd({
    foliage,
    ground: span(0.5, 5.5),
    snowCover: span(0, 0),
    particlesOut: span(0, 1.2),
    particlesIn: span(foliage.end - 1.5, foliage.end + 1.5),
    leafDrop,
    leavesRestUntil: (leafDrop?.end ?? 0) + 4,
  })
}

export function getSeasonTimeline(from: Season, to: Season, reducedMotion: boolean): SeasonTimeline {
  if (from === to) return steadyTimeline
  if (reducedMotion) return gentleTimeline
  if (to === 'winter') return intoWinter
  if (from === 'winter') return outOfWinter
  return betweenGreenSeasons(from, to)
}

export function getWindowFraction(window: SeasonWindow, elapsed: number) {
  if (elapsed >= window.end) return 1
  if (elapsed <= window.start) return 0
  return (elapsed - window.start) / (window.end - window.start)
}

export function getWindowProgress(window: SeasonWindow, elapsed: number) {
  return smoothstep(getWindowFraction(window, elapsed))
}

/** Each tree takes 45% of the window, starting somewhere in its first 55%, so the town turns tree by tree. */
export function getStaggeredWindow(window: SeasonWindow, stagger: number): SeasonWindow {
  const length = window.end - window.start
  return span(window.start + length * 0.55 * stagger, window.start + length * (0.45 + 0.55 * stagger))
}

export function getStaggeredProgress(window: SeasonWindow, elapsed: number, stagger: number) {
  return getWindowProgress(getStaggeredWindow(window, stagger), elapsed)
}

export function createSeasonChange(season: Season): SeasonChange {
  return {
    from: season,
    to: season,
    startedAt: -Infinity,
    timeline: steadyTimeline,
    snowFrom: season === 'winter' ? 1 : 0,
  }
}

export function getSnowCover(change: SeasonChange, now: number) {
  const target = change.to === 'winter' ? 1 : 0
  return lerp(change.snowFrom, target, getWindowProgress(change.timeline.snowCover, now - change.startedAt))
}

export function startSeasonChange(previous: SeasonChange, to: Season, now: number, reducedMotion: boolean) {
  return {
    from: previous.to,
    to,
    startedAt: now,
    timeline: getSeasonTimeline(previous.to, to, reducedMotion),
    snowFrom: getSnowCover(previous, now),
  } satisfies SeasonChange
}

export function isSeasonChangeSettled(change: SeasonChange, now: number) {
  return now - change.startedAt >= change.timeline.end
}

/**
 * How much of `season`'s petal piles, leaf piles, or snow drifts lies under the trees: the new season's grow in,
 * the old season's fade, and leaves stay until the snow buries them.
 */
export function getGroundCoverAmount(season: Season, change: SeasonChange, now: number) {
  const elapsed = now - change.startedAt
  const { foliage, snowCover } = change.timeline
  if (season === change.to) return getWindowProgress(season === 'winter' ? snowCover : foliage, elapsed)
  if (season !== change.from) return 0
  const buried = season === 'winter' || change.to === 'winter'
  return 1 - getWindowProgress(buried ? snowCover : foliage, elapsed)
}

export const seasonClock = () => performance.now() / 1000

export function toLinearColors(colors: readonly string[]) {
  const linear = new Float32Array(colors.length * 3)
  const color = new Color()
  colors.forEach((value, index) => color.set(value).toArray(linear, index * 3))
  return linear
}

export type ColorFade = { from: Float32Array; to: Float32Array }

/** Starts from what is on screen, so a change made mid-transition carries on instead of jumping. */
export function startColorFade(onScreen: ArrayLike<number> | undefined, to: Float32Array): ColorFade {
  return { from: onScreen?.length === to.length ? Float32Array.from(onScreen) : to.slice(), to }
}

export function writeColorFade(fade: ColorFade, progressOf: (index: number) => number, out: Float32Array) {
  for (let channel = 0; channel < fade.to.length; channel += 1) {
    const progress = progressOf(Math.floor(channel / 3))
    out[channel] = lerp(fade.from[channel], fade.to[channel], progress)
  }
}
