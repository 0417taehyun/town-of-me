import type { Object3D } from 'three'
import type { TownObject } from '../../../data/models'
import { clamp, clamp01, seededFraction } from '../../../motionMath'
import type { DayPeriod, SunPosition } from '../../environment/dayCycle'
import { wrap } from '../../environment/atmosphereMotion'
import { objectVariant, resolveVariant } from '../../objectVariant'
import type { BirdVariant } from '../variants'

// Populations of the seed town; a saved town scales the time-of-day populations to its own bird and cloud counts.
export const CLOUD_COUNT = 16
export const PUFFS_PER_CLOUD = 4
export const BIRD_COUNT = 24
export const PARTS_PER_BIRD = 8
export const BIRD_WING_PARTS = [0, 1, 5]
export const BIRD_BODY_PARTS = [2, 3, 6, 7]
export const BIRD_BEAK_PARTS = [4]

const birdPalettes = {
  sparrow: {
    body: '#a9825d',
    head: '#7a5b43',
    wing: '#684a36',
    tail: '#49362b',
    beak: '#d8ad68',
    eye: '#1f1a17',
  },
  pigeon: {
    body: '#77869b',
    head: '#526676',
    wing: '#59687d',
    tail: '#394456',
    beak: '#d4a46f',
    eye: '#d56848',
  },
  robin: {
    body: '#c7643f',
    head: '#744939',
    wing: '#68483d',
    tail: '#46322d',
    beak: '#d5a35c',
    eye: '#171514',
  },
  bluebird: {
    body: '#348ec4',
    head: '#55b1dc',
    wing: '#24669b',
    tail: '#194d7b',
    beak: '#d4a459',
    eye: '#152033',
  },
  goldfinch: {
    body: '#e5bf2d',
    head: '#f2d943',
    wing: '#555640',
    tail: '#363a31',
    beak: '#d89242',
    eye: '#1c1a17',
  },
  parakeet: {
    body: '#5eac69',
    head: '#8bca65',
    wing: '#347c55',
    tail: '#24634e',
    beak: '#e0a64f',
    eye: '#172119',
  },
} satisfies Record<BirdVariant, unknown>

const birdShapes = {
  sparrow: { size: 0.72, wing: 0.82, bodyWidth: 0.86, bodyLength: 0.82, head: 0.84, tail: 0.72, beak: 0.8 },
  pigeon: { size: 1.18, wing: 0.98, bodyWidth: 1.18, bodyLength: 1.08, head: 1.08, tail: 0.72, beak: 0.7 },
  robin: { size: 0.84, wing: 1.08, bodyWidth: 0.92, bodyLength: 0.95, head: 0.94, tail: 0.94, beak: 0.9 },
  bluebird: { size: 0.9, wing: 1.2, bodyWidth: 0.82, bodyLength: 1, head: 0.86, tail: 1.16, beak: 0.92 },
  goldfinch: { size: 0.68, wing: 0.78, bodyWidth: 0.8, bodyLength: 0.76, head: 0.88, tail: 0.68, beak: 0.82 },
  parakeet: { size: 0.96, wing: 1.05, bodyWidth: 0.84, bodyLength: 1.02, head: 0.9, tail: 1.45, beak: 1.05 },
} satisfies Record<BirdVariant, unknown>

const atmospherePopulations = {
  dawn: { clouds: 10, birds: 7 },
  morning: { clouds: 13, birds: 16 },
  noon: { clouds: 10, birds: 9 },
  afternoon: { clouds: 12, birds: 13 },
  sunset: { clouds: 13, birds: 10 },
  evening: { clouds: 8, birds: 3 },
} satisfies Record<DayPeriod, { clouds: number; birds: number }>

export type BirdPalette = (typeof birdPalettes)[BirdVariant]

export function getBirdPalette(species: BirdVariant) {
  return birdPalettes[species]
}

export function getBirdPartColor(palette: BirdPalette, part: number) {
  if (part === 3) return palette.head
  if (part === 4) return palette.beak
  if (part === 5) return palette.tail
  if (part > 5) return palette.eye
  if (part < 2) return palette.wing
  return palette.body
}

export function getBirdShape(species: BirdVariant) {
  return birdShapes[species]
}

export function getAtmospherePopulation(period: DayPeriod) {
  return atmospherePopulations[period]
}

/** How many of a town's birds and clouds are out at this time of day, in the seed town's proportions. */
export function getActiveAtmosphereCounts(period: DayPeriod, birds: number, clouds: number) {
  const population = atmospherePopulations[period]
  return {
    birds: Math.min(birds, Math.ceil((birds * population.birds) / BIRD_COUNT)),
    clouds: Math.min(clouds, Math.ceil((clouds * population.clouds) / CLOUD_COUNT)),
  }
}

/**
 * Moves each bird's or cloud's presence (0 gone, 1 out) toward out for the first `activeCount` and gone for the rest, a
 * whole fade taking `fadeSeconds`, and returns how many lead the list with any presence left: the ones to draw.
 */
export function stepAtmospherePresence(
  presence: Float32Array,
  activeCount: number,
  delta: number,
  fadeSeconds: number,
) {
  const step = delta / Math.max(fadeSeconds, 1e-3)
  presence.forEach((value, index) => {
    presence[index] = clamp01(value + (index < activeCount ? step : -step))
  })
  return presence.reduce((drawn, value, index) => (value > 0 ? index + 1 : drawn), 0)
}

export type CloudSpec = ReturnType<typeof createCloudSpecs>[number]
export type BirdSpec = ReturnType<typeof createBirdSpecs>[number]

// Seeded from each object's id, so motion never re-rolls on render, camera movement, or another object's edit.
export function createCloudSpecs(clouds: TownObject[]) {
  return clouds.map((cloud) => {
    const seed = objectVariant(cloud.id)
    return {
      x: cloud.position.x,
      z: cloud.position.z,
      height: cloud.position.y,
      direction: cloud.rotation,
      scale: cloud.scale,
      color: cloud.color ?? '#ffffff',
      speed: 1.8 + seededFraction(seed, 1) * 1.3,
      phase: seededFraction(seed, 3) * Math.PI * 2,
    }
  })
}

export function createBirdSpecs(birds: TownObject[]) {
  return birds.map((bird) => {
    const seed = objectVariant(bird.id)
    const species = resolveVariant(bird, 'bird')
    const palette = getBirdPalette(species)
    return {
      x: bird.position.x,
      z: bird.position.z,
      height: bird.position.y,
      direction: bird.rotation,
      scale: bird.scale,
      palette: bird.color ? { ...palette, body: bird.color, head: bird.color } : palette,
      speed: 1.7 + seededFraction(seed, 5) * 1.9,
      phase: seededFraction(seed, 6) * Math.PI * 2,
      wander: 1.8 + seededFraction(seed, 7) * 4.2,
      wanderSpeed: 0.18 + seededFraction(seed, 8) * 0.32,
      speedPulse: 0.55 + seededFraction(seed, 9) * 0.7,
      bob: 0.18 + seededFraction(seed, 10) * 0.42,
      bobSpeed: 0.7 + seededFraction(seed, 11) * 0.8,
      species,
    }
  })
}

export function setCloudTransform(dummy: Object3D, clouds: CloudSpec[], index: number, elapsed: number) {
  const cluster = Math.floor(index / PUFFS_PER_CLOUD)
  const puff = index % PUFFS_PER_CLOUD
  const cloud = clouds[cluster]
  dummy.position.set(
    wrap(cloud.x + Math.cos(cloud.direction) * elapsed * cloud.speed, 256) + (puff - 1.5) * 2.5 * cloud.scale,
    cloud.height + Math.sin(puff * 2 + cloud.phase) * 0.6 * cloud.scale,
    wrap(cloud.z + Math.sin(cloud.direction) * elapsed * cloud.speed, 224),
  )
  dummy.rotation.set(0, cloud.phase, 0)
  dummy.scale.set(4.2 * cloud.scale, (1.6 + (puff % 2) * 0.5) * cloud.scale, 2.8 * cloud.scale)
}

export function getCloudShadowOpacity(sunPosition: SunPosition, sunlight: number) {
  const elevationSine = sunPosition[1] / Math.hypot(...sunPosition)
  const opticalPath = 1 / Math.max(0.18, elevationSine)
  const blockedLight = 1 - Math.exp(-0.72 * opticalPath)
  return clamp(blockedLight * Math.min(1, sunlight / 1.6) * 0.28, 0.06, 0.24)
}

export function setCloudShadowTransform(
  dummy: Object3D,
  clouds: CloudSpec[],
  cluster: number,
  elapsed: number,
  sun: SunPosition,
) {
  setCloudTransform(dummy, clouds, cluster * PUFFS_PER_CLOUD + 1, elapsed)
  const projection = dummy.position.y / Math.max(2, sun[1])
  const elevationSine = sun[1] / Math.hypot(...sun)
  const lengthening = Math.min(2.4, 1 / Math.max(0.42, elevationSine))
  dummy.position.set(dummy.position.x - sun[0] * projection, 0.025, dummy.position.z - sun[2] * projection)
  dummy.rotation.set(-Math.PI / 2, 0, Math.atan2(sun[0], sun[2]))
  const size = clouds[cluster].scale
  dummy.scale.set((22 + projection * 2) * size, (15 + projection * 2) * lengthening * size, 1)
}

/** At elapsed 0 the bird is exactly at its anchor, so the editor can place it where it should start flying. */
export function setBirdTransform(
  dummy: Object3D,
  birds: BirdSpec[],
  index: number,
  elapsed: number,
  reducedMotion = false,
) {
  const bird = Math.floor(index / PARTS_PER_BIRD)
  const part = index % PARTS_PER_BIRD
  const side = part === 0 || part === 6 ? -1 : 1
  const spec = birds[bird]
  const shape = getBirdShape(spec.species)
  const near = spec.height < 8
  const angle = spec.direction
  const wanderPhase = elapsed * spec.wanderSpeed + spec.phase
  const speedPulse = (Math.sin(elapsed * spec.speedPulse + spec.phase) - Math.sin(spec.phase)) * 0.8
  const travel = elapsed * spec.speed + speedPulse
  const lateral = (Math.sin(wanderPhase) - Math.sin(spec.phase)) * spec.wander
  const headingOffset = Math.atan2(Math.cos(wanderPhase) * spec.wander * spec.wanderSpeed, spec.speed)
  const flap = Math.sin(elapsed * (8 + spec.speed) + spec.phase) * (reducedMotion ? 0.3 : 0.7)
  const size = shape.size * (near ? 1.24 : 1.48) * spec.scale
  const wing = part < 2
  const eye = part > 5
  const localX = wing
    ? side * (0.14 + Math.cos(flap) * 0.39) * size * shape.wing
    : eye
      ? side * 0.105 * size * shape.head
      : 0
  const localY = wing ? Math.sin(flap) * 0.39 * size : part === 3 || part === 4 || eye ? 0.17 * size : 0
  const localZ = (part === 3 ? 0.32 : part === 4 ? 0.54 : part === 5 ? -0.47 : eye ? 0.45 : 0) * size
  dummy.position.set(
    wrap(spec.x - Math.sin(angle) * travel + Math.cos(angle) * lateral, 156) +
      Math.cos(angle) * localX -
      Math.sin(angle) * localZ,
    spec.height + Math.sin(elapsed * spec.bobSpeed + spec.phase) * spec.bob + Math.abs(flap) * 0.12 + localY,
    wrap(spec.z + Math.cos(angle) * travel + Math.sin(angle) * lateral, 156) +
      Math.sin(angle) * localX +
      Math.cos(angle) * localZ,
  )
  dummy.rotation.set(part === 4 ? Math.PI / 2 : 0, -(angle + headingOffset), wing ? side * flap : 0, 'YXZ')
  if (wing) {
    dummy.scale.set(0.48 * size * shape.wing, 0.05 * size, 0.2 * size)
    return
  }
  if (part === 2) {
    dummy.scale.set(0.19 * size * shape.bodyWidth, 0.16 * size, 0.38 * size * shape.bodyLength)
    return
  }
  if (part === 3) {
    dummy.scale.setScalar(0.17 * size * shape.head)
    return
  }
  if (part === 4) {
    dummy.scale.set(0.08 * size, 0.23 * size * shape.beak, 0.08 * size)
    return
  }
  if (eye) {
    dummy.scale.setScalar(0.038 * size)
    return
  }
  dummy.scale.set(0.23 * size, 0.045 * size, 0.28 * size * shape.tail)
}
