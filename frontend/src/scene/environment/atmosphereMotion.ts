import type { Object3D, Vector3 } from 'three'
import { clamp, clamp01, seededFraction } from '../../motionMath'
import type { Season } from './season'
import { getStaggeredWindow, type SeasonTimeline, type SeasonWindow } from './seasonTransition'
import type { LeafDropSource, SeasonalTreeSource } from '../objects/trees/treeLayout'

export const SEASONAL_PARTICLE_COUNT = 110

const seasonalParticleSettings = {
  spring: { count: 76, fallSpeed: 1.35, wind: 0.72, drift: 1.8, colors: ['#ffd1df', '#f6a9c0', '#fff0f4'] },
  summer: { count: 0, fallSpeed: 0, wind: 0, drift: 0, colors: ['#ffffff'] },
  autumn: { count: 86, fallSpeed: 1.75, wind: 1.05, drift: 2.35, colors: ['#df7a25', '#bd4932', '#efad32'] },
  winter: { count: 110, fallSpeed: 0.82, wind: 0.24, drift: 1.15, colors: ['#ffffff', '#e5f3ff', '#f4fbff'] },
} satisfies Record<Season, { count: number; fallSpeed: number; wind: number; drift: number; colors: readonly string[] }>

const seasonalParticleSpecs = Array.from({ length: SEASONAL_PARTICLE_COUNT }, (_, index) => ({
  x: (seededFraction(index, 21) - 0.5) * 104,
  z: (seededFraction(index, 22) - 0.5) * 104,
  height: seededFraction(index, 23) * 18,
  phase: seededFraction(index, 24) * Math.PI * 2,
  swaySpeed: 0.45 + seededFraction(index, 25) * 0.75,
  size: 0.72 + seededFraction(index, 26) * 0.75,
}))

export function getSeasonalParticleCount(season: Season) {
  return seasonalParticleSettings[season].count
}

export function getSeasonalParticleColor(season: Season, index: number) {
  const colors = seasonalParticleSettings[season].colors
  return colors[index % colors.length]
}

export function advanceAtmosphereTime(elapsed: number, delta: number, reducedMotion: boolean, motionEnabled = true) {
  return elapsed + clamp(delta, 0, 0.1) * (motionEnabled ? (reducedMotion ? 0.28 : 1) : 0)
}

/** The remainder in [0, span), so a value counting down starts over from the top. */
export function positiveModulo(value: number, span: number) {
  return ((value % span) + span) % span
}

/** The same position in [-span / 2, span / 2), so things drifting off one edge come back at the other. */
export function wrap(value: number, span: number) {
  return positiveModulo(value + span / 2, span) - span / 2
}

/** Petals and leaves only fall where trees drop them; snow falls everywhere. */
export function getAmbientParticleCount(season: Season, treeSources: SeasonalTreeSource[]) {
  if (season !== 'winter' && treeSources.length === 0) return 0
  return getSeasonalParticleCount(season)
}

export function setTreeParticleTransform(
  dummy: Object3D,
  index: number,
  elapsed: number,
  season: Season,
  source: SeasonalTreeSource,
) {
  const particle = seasonalParticleSpecs[index]
  const settings = seasonalParticleSettings[season]
  const phase = elapsed * particle.swaySpeed + particle.phase
  const fallSpan = source.dropHeight - source.groundY
  const height = positiveModulo(particle.height * (fallSpan / 18) - elapsed * settings.fallSpeed, fallSpan)
  const radius = source.scale * (0.35 + seededFraction(index, 27) * 1.55)
  dummy.position.set(
    source.x + Math.cos(particle.phase) * radius + Math.sin(phase) * settings.wind * 0.42,
    source.groundY + height,
    source.z + Math.sin(particle.phase) * radius + Math.cos(phase * 0.73) * settings.wind * 0.42,
  )
  dummy.rotation.set(Math.sin(phase) * 0.75, phase * 0.4, phase)
  dummy.scale.set(0.2 * particle.size, 0.09 * particle.size, 0.12 * particle.size)
  return (fallSpan - height) / settings.fallSpeed
}

/** Places a falling petal, leaf, or snowflake and returns how many seconds ago it set off from the top of its fall. */
export function setSeasonalParticleTransform(
  dummy: Object3D,
  index: number,
  elapsed: number,
  season: Season,
  treeSources: SeasonalTreeSource[] = [],
) {
  const source = treeSources[index % treeSources.length]
  if (season !== 'winter' && source) return setTreeParticleTransform(dummy, index, elapsed, season, source)
  const particle = seasonalParticleSpecs[index]
  const settings = seasonalParticleSettings[season]
  const phase = elapsed * particle.swaySpeed + particle.phase
  const height = positiveModulo(particle.height - elapsed * settings.fallSpeed, 18)
  dummy.position.set(
    wrap(particle.x + elapsed * settings.wind + Math.sin(phase) * settings.drift, 104),
    0.7 + height,
    wrap(particle.z + Math.cos(phase * 0.73) * settings.drift, 104),
  )
  dummy.rotation.set(Math.sin(phase) * 0.75, phase * 0.4, phase)
  const fallingFor = (18 - height) / settings.fallSpeed
  if (season !== 'winter') {
    dummy.scale.set(0.2 * particle.size, 0.09 * particle.size, 0.12 * particle.size)
    return fallingFor
  }
  dummy.scale.setScalar(0.13 * particle.size)
  return fallingFor
}

/**
 * How much of a falling particle shows while one season hands over to the next: each particle has its own moment
 * in `gate`. Petals and leaves only join at the top of a fresh fall and finish the fall they are in, so none pops
 * in or out beside a tree; snow falls for so long that flakes grow in or shrink away instead.
 */
export function getSeasonalParticleVisibility(
  index: number,
  elapsed: number,
  fallingFor: number,
  gate: SeasonWindow | null,
  joining: boolean,
  season: Season,
) {
  if (!gate) return 1
  const moment = gate.start + seededFraction(index, 28) * (gate.end - gate.start)
  if (season === 'winter') {
    const grown = clamp01((elapsed - moment) / 1.2)
    return joining ? grown : 1 - grown
  }
  const setOffBeforeMoment = elapsed - fallingFor < moment
  return Number(joining !== setOffBeforeMoment)
}

export const STAR_COUNT = 260
export const FIREFLY_COUNT = 64
/** Fireflies repeat in tiles of this size around the view, so a few dozen always fill the meadow nearby. */
const FIREFLY_TILE = 36

/** Stars spread evenly over the sky dome from just above the horizon to the zenith, each with its own brightness. */
export function createStarField(count: number, radius: number) {
  const positions = new Float32Array(count * 3)
  const colors = new Float32Array(count * 3)
  for (let index = 0; index < count; index += 1) {
    const elevationSine = 0.12 + seededFraction(index, 51) * 0.88
    const azimuth = seededFraction(index, 52) * Math.PI * 2
    const across = Math.sqrt(1 - elevationSine * elevationSine) * radius
    const brightness = 0.35 + seededFraction(index, 53) ** 2 * 0.65
    positions.set([Math.cos(azimuth) * across, elevationSine * radius, Math.sin(azimuth) * across], index * 3)
    colors.set([brightness * 0.92, brightness * 0.95, brightness], index * 3)
  }
  return { positions, colors }
}

/** A firefly wandering slowly in a loop near the grass, repeated around `centerX`/`centerZ`. */
export function setFireflyPosition(out: Vector3, index: number, elapsed: number, centerX: number, centerZ: number) {
  const wander = elapsed * (0.18 + seededFraction(index, 61) * 0.22) + seededFraction(index, 62) * Math.PI * 2
  const x = seededFraction(index, 63) * FIREFLY_TILE + Math.sin(wander) * 1.4 + Math.sin(wander * 0.37) * 0.8
  const z = seededFraction(index, 64) * FIREFLY_TILE + Math.cos(wander * 0.83) * 1.4
  out.set(
    centerX + wrap(x - centerX, FIREFLY_TILE),
    0.5 + seededFraction(index, 65) * 1.6 + Math.sin(wander * 1.7) * 0.3,
    centerZ + wrap(z - centerZ, FIREFLY_TILE),
  )
}

/** Mostly dark with a slow soft blink; with reduced motion each one glows steadily instead of flashing. */
export function getFireflyGlow(index: number, elapsed: number, reducedMotion: boolean) {
  if (reducedMotion) return 0.6
  const pulse = Math.sin(elapsed * (0.9 + seededFraction(index, 66) * 0.8) + seededFraction(index, 67) * Math.PI * 2)
  // A faint glow between flashes keeps each firefly findable; the flash itself stays short.
  return 0.22 + 0.78 * Math.max(0, pulse) ** 2
}

export const LEAVES_PER_TREE = 6
export const LEAF_DROP_CAPACITY = 420

export const hideParticle = (dummy: Object3D) => {
  dummy.position.set(0, -20, 0)
  dummy.scale.setScalar(0)
}

/**
 * One leaf (or petal) of a tree shedding everything at the season change: it lets go while its tree changes color,
 * flutters down, and lies on the ground until `timeline.leavesRestUntil` before it fades.
 */
export function setLeafDropTransform(
  dummy: Object3D,
  index: number,
  sinceChange: number,
  sources: LeafDropSource[],
  timeline: SeasonTimeline,
) {
  const source = sources[Math.floor(index / LEAVES_PER_TREE)]
  if (!source || !timeline.leafDrop) return hideParticle(dummy)
  const treeWindow = getStaggeredWindow(timeline.leafDrop, source.stagger)
  const flight = sinceChange - (treeWindow.start + seededFraction(index, 41) * (treeWindow.end - treeWindow.start))
  if (flight < 0) return hideParticle(dummy)
  const angle = seededFraction(index, 42) * Math.PI * 2
  const radius = source.scale * (0.45 + seededFraction(index, 43) * 1.25)
  const startHeight = source.groundY + source.scale * (2.7 + seededFraction(index, 44) * 2)
  const fallSpeed = 1.05 + seededFraction(index, 45) * 0.6
  const airborne = Math.min(flight, (startHeight - source.groundY) / fallSpeed)
  const sway = airborne * (1.7 + seededFraction(index, 46))
  const fading = clamp01((sinceChange - timeline.leavesRestUntil - seededFraction(index, 47)) / 1.2)
  const size = 0.82 + seededFraction(index, 48) * 0.5
  dummy.position.set(
    source.x + Math.cos(angle) * radius + Math.sin(sway * 2 + angle) * 0.5 + airborne * 0.22,
    Math.max(source.groundY - 0.02, startHeight - airborne * fallSpeed),
    source.z + Math.sin(angle) * radius + Math.cos(sway * 1.4 + angle) * 0.42,
  )
  dummy.scale.set(0.2 * size, 0.09 * size, 0.12 * size).multiplyScalar(1 - fading)
  const landed = flight >= (startHeight - source.groundY) / fallSpeed
  if (landed) {
    dummy.rotation.set(-Math.PI / 2, 0, angle)
    return
  }
  dummy.rotation.set(Math.sin(sway * 2.3) * 0.9, sway * 0.6, sway * 1.8)
}
