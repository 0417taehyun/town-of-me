import { Color, type Object3D, Shape, ShapeGeometry } from 'three'
import type { Vec3 } from '../../data/models'
import { clamp01, seededFraction } from '../../motionMath'
import { getSeasonalParticleColor, positiveModulo } from '../../scene/environment/atmosphereMotion'
import type { Season } from '../../scene/environment/season'
import { flowerColors } from '../../scene/objects/flowers/flowerLayout'
import { FENCE_HEIGHT, fenceDistance, FOUL_ANGLE } from '../game/field'
import type { FlowerBed } from './bowlLayout'
import { sweptPoint } from './fieldLayout'
import { LIGHT_TOWERS } from './landmarkLayout'

// The garden's breeze (GardenBreeze.tsx): petals or leaves drifting round the park, butterflies over the flower beds
// by day, and a burst of petals when a home run clears the hedge. None of it is near the pitch or in front of the ball.

/** What each performance tier draws: drifting petals, the share of a burst's petals, and butterflies. */
export const BREEZE_COUNTS = {
  full: { drift: 120, burst: 1, butterflies: 10 },
  reduced: { drift: 40, burst: 0.4, butterflies: 4 },
}

/**
 * Where the drift stays (m from home plate): beyond the infield, so it never crosses the pitch's line from the mound
 * to the plate, and no wider than the stands, so it is always in front of the batting camera.
 */
export const DRIFT_FIELD = { nearest: 36, farthest: 110, spray: FOUL_ANGLE + 0.5, top: 9, bottom: 0.4, sway: 0.8 }
/** How much of the drift a season shows; winter's snow already falls from the town's sky. */
export const DRIFT_SHARE = { spring: 1, summer: 0.6, autumn: 1, winter: 0 } satisfies Record<Season, number>
/** m/s along each petal's circle round the park, and down. */
const BREEZE_SPEED = { along: 2.4, down: 0.7 }

/** How far (m) a petal keeps from the camera's line to the ball: hidden inside `inner`, whole past `outer`. */
export const SIGHT_CLEARANCE = { inner: 0.8, outer: 2 }

export type Sight = { eye: Vec3; ball: Vec3 | null }

/** A petal or leaf in the season's colors: the town's falling ones, or in summer, which has none, the flowers'. */
export function petalColor(season: Season, index: number) {
  if (season === 'summer') return flowerColors[index % flowerColors.length]
  return getSeasonalParticleColor(season, index)
}

/** 1 for a point well clear of the camera's line to the ball, falling to 0 on it, so nothing drawn hides the ball. */
export function sightClearance(point: Vec3, { eye, ball }: Sight) {
  if (!ball) return 1
  const toBall = { x: ball.x - eye.x, y: ball.y - eye.y, z: ball.z - eye.z }
  const lengthSquared = toBall.x ** 2 + toBall.y ** 2 + toBall.z ** 2 || 1
  const along = clamp01(
    ((point.x - eye.x) * toBall.x + (point.y - eye.y) * toBall.y + (point.z - eye.z) * toBall.z) / lengthSquared,
  )
  const distance = Math.hypot(
    point.x - eye.x - toBall.x * along,
    point.y - eye.y - toBall.y * along,
    point.z - eye.z - toBall.z * along,
  )
  return clamp01((distance - SIGHT_CLEARANCE.inner) / (SIGHT_CLEARANCE.outer - SIGHT_CLEARANCE.inner))
}

/**
 * The `index`th drifting petal `elapsed` s into the breeze: carried round the park on its own circle and falling,
 * shrinking away at the drift's edges and the ground so none pops in or out.
 */
export function poseDriftPetal(dummy: Object3D, index: number, elapsed: number, sight: Sight) {
  const { nearest, farthest, spray, top, bottom, sway } = DRIFT_FIELD
  const distance = nearest + sway + seededFraction(index, 71) * (farthest - nearest - sway)
  const phase = elapsed * (0.5 + seededFraction(index, 72) * 0.6) + seededFraction(index, 73) * Math.PI * 2
  const angle =
    positiveModulo(seededFraction(index, 74) * 2 * spray + (elapsed * BREEZE_SPEED.along) / distance, 2 * spray) - spray
  const fall = top - bottom
  const height = bottom + positiveModulo(seededFraction(index, 75) * fall - elapsed * BREEZE_SPEED.down, fall)
  const [x, , z] = sweptPoint(angle, distance + Math.sin(phase) * sway, 0)
  dummy.position.set(x, height, z)
  dummy.rotation.set(Math.sin(phase) * 0.75, phase * 0.4, phase)
  const edge = clamp01((spray - Math.abs(angle)) / 0.15) * clamp01((height - bottom) / 0.6)
  const size = (1.2 + seededFraction(index, 76) * 0.9) * edge * sightClearance(dummy.position, sight)
  dummy.scale.set(0.36 * size, 0.16 * size, 0.22 * size)
}

/** The home run burst's petals: how many from over the hedge and from each far light tower, how fast, how long. */
export const BURST = {
  capacity: 320,
  fence: 200,
  tower: 60,
  power: 14,
  life: { least: 3.5, spread: 2, fading: 0.6 },
  gravity: 3.2,
  fallSpeed: 1.4,
  drag: 1.4,
}

/** A fixed pool of burst petals; each burst takes over the oldest, so the pool never grows. */
export type PetalPool = {
  positions: Float32Array
  velocities: Float32Array
  lives: Float32Array
  colors: Float32Array
  cursor: number
  started: number
  /** When (s of the breeze) the last petal of the latest burst is gone. */
  endsAt: number
}

export function createPetalPool(capacity: number): PetalPool {
  return {
    positions: new Float32Array(capacity * 3),
    velocities: new Float32Array(capacity * 3),
    lives: new Float32Array(capacity),
    colors: new Float32Array(capacity * 3),
    cursor: 0,
    started: 0,
    endsAt: 0,
  }
}

/** Flings `count` petals in `colors` up and out of `origin` at about `power` m/s, `elapsed` s into the breeze. */
export function burstPetals(
  pool: PetalPool,
  origin: Vec3,
  count: number,
  colors: readonly Color[],
  elapsed: number,
  power = BURST.power,
) {
  for (let started = 0; started < count; started += 1) startPetal(pool, origin, colors, power)
  pool.endsAt = elapsed + BURST.life.least + BURST.life.spread
}

export function startPetal(pool: PetalPool, origin: Vec3, colors: readonly Color[], power: number) {
  const index = pool.cursor
  const seed = pool.started
  pool.cursor = (index + 1) % pool.lives.length
  pool.started += 1
  const angle = seededFraction(seed, 81) * Math.PI * 2
  const lift = 0.3 + seededFraction(seed, 82) * 0.5
  const speed = power * (0.5 + seededFraction(seed, 83) * 0.6)
  pool.positions.set([origin.x, origin.y, origin.z], index * 3)
  pool.velocities.set(
    [Math.cos(angle) * (1 - lift) * speed, lift * speed, Math.sin(angle) * (1 - lift) * speed],
    index * 3,
  )
  pool.lives[index] = BURST.life.least + seededFraction(seed, 84) * BURST.life.spread
  colors[seed % colors.length].toArray(pool.colors, index * 3)
}

/** Moves a live petal on by `delta` s: drag slows it, it falls no faster than a petal floats, and it rests on grass. */
export function advancePetal(pool: PetalPool, index: number, delta: number) {
  if (pool.lives[index] <= 0) return
  pool.lives[index] -= delta
  const { positions, velocities } = pool
  const at = index * 3
  velocities[at] *= 1 - BURST.drag * delta
  velocities[at + 1] = Math.max(velocities[at + 1] - BURST.gravity * delta, -BURST.fallSpeed)
  velocities[at + 2] *= 1 - BURST.drag * delta
  positions[at] += velocities[at] * delta
  positions[at + 1] = Math.max(0.05, positions[at + 1] + velocities[at + 1] * delta)
  positions[at + 2] += velocities[at + 2] * delta
}

/** A burst petal as drawn: fluttering about its path and tumbling, and shrinking away at the end of its life. */
export function poseBurstPetal(dummy: Object3D, pool: PetalPool, index: number, elapsed: number, sight: Sight) {
  const at = index * 3
  const phase = elapsed * 3 + index
  dummy.position.set(
    pool.positions[at] + Math.sin(phase) * 0.5,
    pool.positions[at + 1],
    pool.positions[at + 2] + Math.cos(phase * 0.77) * 0.4,
  )
  dummy.rotation.set(Math.sin(phase) * 0.9, phase * 0.5, phase * 0.8)
  const fading = clamp01(pool.lives[index] / BURST.life.fading)
  const size = (0.8 + seededFraction(index, 86) * 0.6) * fading * sightClearance(dummy.position, sight)
  dummy.scale.set(0.5 * size, 0.22 * size, 0.32 * size)
}

/** True once a ball is past the hedge in its own direction. */
export function pastFence(position: Vec3) {
  const spray = Math.atan2(position.x, -position.z)
  return Math.hypot(position.x, position.z) > fenceDistance(spray)
}

/** Whether a home run's burst starts now: once its ball, still flying, has cleared the hedge, and only once. */
export function homeRunBurstDue(
  homeRun: boolean,
  alreadyBurst: boolean,
  ball: { flying: boolean; position: Vec3 } | null,
) {
  return homeRun && !alreadyBurst && !!ball?.flying && pastFence(ball.position)
}

/** Where a home run's petals burst from: over the hedge where its ball crossed, and atop the two far light towers. */
export function burstOrigins(ball: Vec3) {
  const spray = Math.atan2(ball.x, -ball.z)
  const [x, y, z] = sweptPoint(spray, fenceDistance(spray) + 3, FENCE_HEIGHT + 3)
  const towers = LIGHT_TOWERS.filter((tower) => Math.hypot(tower.x, tower.z) > 125).map((tower) => ({
    x: tower.x,
    y: tower.height + 1,
    z: tower.z,
  }))
  return { fence: { x, y, z }, towers }
}

export const BUTTERFLY_COLORS = ['#ffe08a', '#ffb3c7', '#ffffff', '#c9b6f0', '#9cc9e4', '#ff9f80']
/** A butterfly's loop over its flower bed (m) and its size against the drafts' (the batting view sees them far off). */
const BUTTERFLY = { loop: 2.6, height: 1.1, size: 2 }

/** One wing, flat and reaching along +x from the body. */
export function createWingGeometry() {
  const wing = new Shape()
  wing.moveTo(0, 0)
  wing.bezierCurveTo(0.12, 0.26, 0.34, 0.24, 0.3, 0.06)
  wing.bezierCurveTo(0.34, -0.06, 0.2, -0.22, 0, -0.04)
  return new ShapeGeometry(wing, 8).rotateX(-Math.PI / 2)
}

/**
 * One wing of the `index / 2`th butterfly, looping lazily over a flower bed in foul ground and flapping; `shown`
 * (0–1) grows it in by day and away at night. `dummy` turns yaw first (rotation order YXZ).
 */
export function poseButterflyWing(
  dummy: Object3D,
  index: number,
  elapsed: number,
  beds: readonly FlowerBed[],
  shown: number,
) {
  const butterfly = Math.floor(index / 2)
  const side = index % 2 === 0 ? 1 : -1
  const bed = beds[(butterfly * 5) % beds.length]
  const turn = elapsed * (0.25 + seededFraction(butterfly, 91) * 0.2) + seededFraction(butterfly, 92) * 10
  dummy.position.set(
    bed.x + Math.sin(turn) * BUTTERFLY.loop,
    BUTTERFLY.height + Math.sin(turn * 3.1) * 0.35,
    bed.z + Math.sin(turn * 2) * BUTTERFLY.loop * 0.45,
  )
  const flap = 0.25 + Math.abs(Math.sin(elapsed * 13 + butterfly)) * 1.05
  dummy.rotation.set(0.2, Math.atan2(Math.cos(turn), Math.cos(turn * 2) * 0.9), side * flap)
  const size = BUTTERFLY.size * shown
  dummy.scale.set(side * size, size, size)
}

/** The burst's colors for `season`, as colors to copy from. */
export function burstColors(season: Season) {
  return Array.from({ length: 6 }, (_, index) => new Color(petalColor(season, index)))
}

/** A home run's whole burst in `season`'s colors, `share` of its petals for this performance tier. */
export function burstForHomeRun(pool: PetalPool, ball: Vec3, season: Season, elapsed: number, share: number) {
  const colors = burstColors(season)
  const { fence, towers } = burstOrigins(ball)
  burstPetals(pool, fence, Math.round(BURST.fence * share), colors, elapsed)
  towers.forEach((tower) => burstPetals(pool, tower, Math.round(BURST.tower * share), colors, elapsed, 10))
}
