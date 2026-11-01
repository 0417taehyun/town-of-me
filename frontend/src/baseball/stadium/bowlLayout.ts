import { BufferGeometry, Float32BufferAttribute, Matrix4, type Object3D, Shape, ShapeGeometry, Vector2 } from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import type { TownObject } from '../../data/models'
import { seededFraction } from '../../motionMath'
import { fenceDistance, FOUL_ANGLE } from '../game/field'
import { LONGEST_CARRY, SPRAY_RULES } from '../game/landing'
import { LANDING_CAMERA } from '../stage/cameraShots'
import { createArcSweep, type SweepProfile, sweptPoint } from './fieldLayout'

// The garden bowl around the field, in the field meters of fieldLayout.ts: the stands along both foul lines and behind
// home, the glass conservatory over the seats behind home, flower beds in foul territory, and beyond the outfield a lawn
// where home runs come down, ringed by a tall hedge, trees, and hills. Nothing here is judged.

/** The stands: `offset` m off each foul line and behind home, `tiers` steps of `depth` × `rise` from a `base` wall. */
export const STANDS = { offset: 16, tiers: 11, depth: 2.1, rise: 1.05, base: 1.3, lineLength: 80, back: 2, wall: 0.4 }
export const STANDS_TOP = STANDS.base + (STANDS.tiers - 1) * STANDS.rise
export const STANDS_DEPTH = STANDS.tiers * STANDS.depth
const BEHIND_HOME_STEPS = 26

/** A point of the stands' front edge and the level direction away from the field there. */
export type StandSample = { x: number; z: number; outX: number; outZ: number }

/** The stands' front edge: along the first-base line toward home, round behind it, and out along the third-base line. */
export function standCurve(): StandSample[] {
  const firstBase = Array.from({ length: STANDS.lineLength }, (_, index) => lineSample(1, STANDS.lineLength - index))
  const behindHome = Array.from({ length: BEHIND_HOME_STEPS + 1 }, (_, step) =>
    arcSample((3 * Math.PI) / 4 + (step / BEHIND_HOME_STEPS) * (Math.PI / 2)),
  )
  const thirdBase = Array.from({ length: STANDS.lineLength }, (_, index) => lineSample(-1, index + 1))
  return [...firstBase, ...behindHome, ...thirdBase]
}

/** `along` m out a foul line (`side` 1 is first base), `STANDS.offset` m off it. */
export function lineSample(side: number, along: number): StandSample {
  const half = Math.SQRT1_2
  return {
    x: side * half * (along + STANDS.offset),
    z: half * (STANDS.offset - along),
    outX: side * half,
    outZ: half,
  }
}

export function arcSample(spray: number): StandSample {
  const [x, , z] = sweptPoint(spray, STANDS.offset, 0)
  return { x, z, outX: Math.sin(spray), outZ: -Math.cos(spray) }
}

export function standPoint(sample: StandSample, out: number, up: number) {
  return [sample.x + sample.outX * out, up, sample.z + sample.outZ * out]
}

/** Two triangles over four corners in turn, facing the side they run counterclockwise on. */
export function quadTriangles(corners: number[][]) {
  return [0, 1, 2, 0, 2, 3].flatMap((corner) => corners[corner])
}

/** A wall `out` m back between two samples, from `bottom` to `top`: facing the field, or away from it when `away`. */
export function standWall(from: StandSample, to: StandSample, out: number, bottom: number, top: number, away = false) {
  const corners = [standPoint(from, out, bottom), standPoint(to, out, bottom), standPoint(to, out, top)]
  corners.push(standPoint(from, out, top))
  return quadTriangles(away ? corners.reverse() : corners)
}

export function standFloor(from: StandSample, to: StandSample, near: number, far: number, up: number) {
  return quadTriangles([
    standPoint(from, near, up),
    standPoint(to, near, up),
    standPoint(to, far, up),
    standPoint(from, far, up),
  ])
}

export function tierHeight(tier: number) {
  return STANDS.base + tier * STANDS.rise
}

/** One stretch of the stands between two samples: the front wall, the steps, the back rest, and the outer wall. */
export function standSegment(from: StandSample, to: StandSample) {
  const { depth, back, wall } = STANDS
  const steps = Array.from({ length: STANDS.tiers }, (_, tier) => [
    ...standWall(from, to, tier * depth, tier === 0 ? 0 : tierHeight(tier - 1), tierHeight(tier)),
    ...standFloor(from, to, tier * depth, (tier + 1) * depth, tierHeight(tier)),
  ]).flat()
  return [
    ...steps,
    ...standWall(from, to, STANDS_DEPTH, STANDS_TOP, STANDS_TOP + back),
    ...standWall(from, to, STANDS_DEPTH + wall, 0, STANDS_TOP + back, true),
  ]
}

/** The stepped side of the stands at one end, facing along the line away from home, or toward it when `away` is false. */
export function standEnd(sample: StandSample, away: boolean) {
  const { depth, back, wall } = STANDS
  const columns = [
    ...Array.from({ length: STANDS.tiers }, (_, tier) => [tier * depth, (tier + 1) * depth, tierHeight(tier)]),
    [STANDS_DEPTH, STANDS_DEPTH + wall, STANDS_TOP + back],
  ]
  return columns.flatMap(([near, far, up]) => {
    const corners = [standPoint(sample, near, 0), standPoint(sample, far, 0), standPoint(sample, far, up)]
    corners.push(standPoint(sample, near, up))
    return quadTriangles(away ? corners.reverse() : corners)
  })
}

/**
 * The stands as one mesh in two groups: the body in the walls' color (group 0), and the cap along the top of the back
 * wall in the roof's (group 1), so an admin's colors repaint them.
 */
export function createStandsGeometry() {
  const samples = standCurve()
  const pairs = samples.slice(1).map((to, index) => [samples[index], to] as const)
  const body = [
    ...pairs.flatMap(([from, to]) => standSegment(from, to)),
    ...standEnd(samples[0], true),
    ...standEnd(samples[samples.length - 1], false),
  ]
  const top = STANDS_TOP + STANDS.back
  const cap = pairs.flatMap(([from, to]) => standFloor(from, to, STANDS_DEPTH, STANDS_DEPTH + STANDS.wall, top))
  const geometry = new BufferGeometry()
  geometry.setAttribute('position', new Float32BufferAttribute([...body, ...cap], 3))
  geometry.computeVertexNormals()
  geometry.addGroup(0, body.length / 3, 0)
  geometry.addGroup(body.length / 3, cap.length / 3, 1)
  return geometry
}

/** A seat: where its sitter's feet go, which way it faces (yaw), and which section (they alternate colors). */
export type Seat = { x: number; y: number; z: number; yaw: number; section: number }

export const SEATING = { spacing: 0.92, sectionLength: 15, aisle: 1.4, facing: { x: 0, z: -24 } }

/** A seat every `spacing` m along each tier, with an aisle at the start of every section, all facing the infield. */
export function standSeats(): Seat[] {
  const samples = standCurve()
  return Array.from({ length: STANDS.tiers }, (_, tier) => tierSeats(samples, tier)).flat()
}

export function tierSeats(samples: StandSample[], tier: number): Seat[] {
  const out = (tier + 0.55) * STANDS.depth
  const line = samples.map((sample) => standPoint(sample, out, tierHeight(tier)))
  const travelled = line.map((_, index) =>
    line.slice(1, index + 1).reduce((total, point, step) => total + pointDistance(line[step], point), 0),
  )
  const count = Math.floor((travelled[travelled.length - 1] - 1.2) / SEATING.spacing)
  return Array.from({ length: count }, (_, index) => 1.2 + index * SEATING.spacing)
    .filter((distance) => distance % SEATING.sectionLength > SEATING.aisle)
    .map((distance) => seatAt(line, travelled, distance))
}

export function pointDistance(from: number[], to: number[]) {
  return Math.hypot(to[0] - from[0], to[2] - from[2])
}

export function seatAt(line: number[][], travelled: number[], distance: number): Seat {
  const next = Math.max(
    1,
    travelled.findIndex((total) => total >= distance),
  )
  const amount = (distance - travelled[next - 1]) / Math.max(1e-6, travelled[next] - travelled[next - 1])
  const [fromX, y, fromZ] = line[next - 1]
  const x = fromX + (line[next][0] - fromX) * amount
  const z = fromZ + (line[next][2] - fromZ) * amount
  const yaw = Math.atan2(SEATING.facing.x - x, SEATING.facing.z - z)
  return { x, y, z, yaw, section: Math.floor(distance / SEATING.sectionLength) }
}

/** A seat's back, behind where its sitter's feet go. */
export function setSeatBack(dummy: Object3D, seat: Seat) {
  dummy.position.set(seat.x - Math.sin(seat.yaw) * 0.55, seat.y + 0.32, seat.z - Math.cos(seat.yaw) * 0.55)
  dummy.rotation.set(0, seat.yaw, 0)
  dummy.scale.set(1, 1, 1)
}

/** The conservatory: a glass barrel vault behind home from the fourth tier up to the back wall, rising to the top. */
export const CONSERVATORY = {
  from: (3 * Math.PI) / 4 - 0.02,
  to: (5 * Math.PI) / 4 + 0.02,
  front: STANDS.offset + 3.6 * STANDS.depth,
  span: STANDS_DEPTH - 3.6 * STANDS.depth + 0.6,
  spring: STANDS_TOP + 2.2,
  ribs: 13,
}

/** Up the glass front from the fourth tier, then over the vault to the back wall. */
export function conservatoryProfile(): SweepProfile {
  const half = CONSERVATORY.span / 2
  const vault = Array.from({ length: 17 }, (_, step) => {
    const angle = Math.PI - (step / 16) * Math.PI
    return [half + Math.cos(angle) * half, CONSERVATORY.spring + Math.sin(angle) * half * 0.85] as const
  })
  return [[0, tierHeight(3) + 0.1], ...vault]
}

/** The glass vault and its two end walls as one geometry. */
export function createConservatoryGlass() {
  const profile = conservatoryProfile()
  const { from, to, front } = CONSERVATORY
  const arc = { from, to, steps: 48, radiusAt: () => front, textureRadius: front }
  const vault = createArcSweep(profile, arc, { textureMeters: 5 }).toNonIndexed()
  const outline = new Shape().setFromPoints(profile.map(([out, up]) => new Vector2(out, up)))
  outline.lineTo(CONSERVATORY.span, STANDS_TOP)
  outline.lineTo(0, profile[0][1])
  const ends = [from, to].map((spray) => {
    const [x, , z] = sweptPoint(spray, front, 0)
    const end = new ShapeGeometry(outline, 12).toNonIndexed()
    end.applyMatrix4(new Matrix4().makeTranslation(x, 0, z).multiply(new Matrix4().makeRotationY(Math.PI / 2 - spray)))
    return end
  })
  return mergeGeometries([vault, ...ends]) ?? vault
}

/** Where the vault's ribs stand, as yaws around home for one rib drawn in the plane straight behind home. */
export function conservatoryRibYaws() {
  const { from, to, ribs } = CONSERVATORY
  return Array.from({ length: ribs }, (_, step) => Math.PI - (from + ((to - from) * step) / (ribs - 1)))
}

/** The rib's path in the plane straight behind home (+z), for a tube to follow. */
export function conservatoryRibPoints() {
  return conservatoryProfile().map(([out, up]) => [0, up, CONSERVATORY.front + out] as const)
}

/**
 * Home runs come down, and the landing camera stands, inside this fan beyond the hedge: up to the fair balls' widest
 * spray and past the longest carry by the camera's distance. Nothing taller than a flower grows there.
 */
export const HOME_RUN_LAWN = {
  spray: SPRAY_RULES.fairEdge + 0.08,
  reach: LONGEST_CARRY + LANDING_CAMERA.beyond + 10,
}

export function sprayOf(x: number, z: number) {
  return Math.atan2(x, -z)
}

export function isOnHomeRunLawn(x: number, z: number) {
  return Math.abs(sprayOf(x, z)) <= HOME_RUN_LAWN.spray && Math.hypot(x, z) <= HOME_RUN_LAWN.reach
}

/**
 * A low terrace of bleachers just past the home-run lawn's reach, a wing either side of the oak inside the outer
 * hedge: `tiers` steps of `depth` × `rise` from a `base` wall, high enough for its back rows to show over the outfield
 * hedge from the batting view, under a `back` rest `wall` m thick.
 */
export const TERRACE = {
  front: HOME_RUN_LAWN.reach + 1,
  inner: 0.09,
  outer: 0.36,
  tiers: 4,
  depth: 1.25,
  rise: 0.9,
  base: 1.8,
  back: 0.8,
  wall: 0.3,
}

/**
 * The terrace's cross-section, from its back's foot along the ground, up its front, step by step to the back rest, and
 * down its back. As every step rises away from the field, each corner can be seen from that first point, so the sweep
 * can close both ends with triangles from it.
 */
export function terraceProfile(): SweepProfile {
  const { tiers, depth, rise, base, back, wall } = TERRACE
  const steps = Array.from({ length: tiers }, (_, tier) => [
    [tier * depth, base + tier * rise] as const,
    [(tier + 1) * depth, base + tier * rise] as const,
  ]).flat()
  const top = base + (tiers - 1) * rise + back
  const behind = tiers * depth + wall
  return [[behind, 0], [0, 0], ...steps, [tiers * depth, top], [behind, top], [behind, 0]]
}

/** Both wings of the terrace as one geometry, flat-shaded like the stands. */
export function createTerraceGeometry() {
  const profile = terraceProfile()
  const wings = [-1, 1].map((side) => {
    const sprays = [side * TERRACE.inner, side * TERRACE.outer].sort((first, second) => first - second)
    const arc = {
      from: sprays[0],
      to: sprays[1],
      steps: 16,
      radiusAt: () => TERRACE.front,
      textureRadius: TERRACE.front,
    }
    return createArcSweep(profile, arc, { caps: true }).toNonIndexed()
  })
  const geometry = mergeGeometries(wings) ?? new BufferGeometry()
  geometry.computeVertexNormals()
  return geometry
}

/** The terrace's seats, on both wings: a seat every `SEATING.spacing` m along each step, all facing the infield. */
export function terraceSeats(): Seat[] {
  return [-1, 1].flatMap((side) =>
    Array.from({ length: TERRACE.tiers }, (_, tier) => terraceTierSeats(side, tier)).flat(),
  )
}

export function terraceTierSeats(side: number, tier: number): Seat[] {
  const radius = TERRACE.front + (tier + 0.55) * TERRACE.depth
  const span = TERRACE.outer - TERRACE.inner
  const count = Math.floor((span * radius) / SEATING.spacing)
  return Array.from({ length: count }, (_, index) => {
    const [x, , z] = sweptPoint(side * (TERRACE.inner + ((index + 0.5) / count) * span), radius, 0)
    const yaw = Math.atan2(SEATING.facing.x - x, SEATING.facing.z - z)
    return { x, y: TERRACE.base + tier * TERRACE.rise, z, yaw, section: 0 }
  })
}

/** The tall hedge round the whole park: a circle about a point out toward center field. */
export const OUTER_HEDGE = { centerZ: -45, radius: 155 }
export const OUTER_HEDGE_PROFILE: SweepProfile = [
  [0, 0],
  [0, 8.4],
  [0.5, 9.4],
  [2, 9.8],
  [3.6, 9.2],
  [4, 8],
  [4, 0],
]
export const OUTER_HEDGE_TOP = 9.4
export const OUTER_HEDGE_SNOW_PROFILE: SweepProfile = [
  [0.35, 9.3],
  [0.6, 9.95],
  [3.4, 9.75],
  [3.7, 9.15],
]

/** How far from home plate the outer hedge's inner face is at `spray`. */
export function outerHedgeDistance(spray: number) {
  const toward = -Math.cos(spray) * OUTER_HEDGE.centerZ
  return toward + Math.sqrt(toward * toward - OUTER_HEDGE.centerZ ** 2 + OUTER_HEDGE.radius ** 2)
}

export function createOuterHedgeSweep(profile: SweepProfile) {
  const arc = { from: -Math.PI, to: Math.PI, steps: 180, radiusAt: outerHedgeDistance, textureRadius: 120 }
  return createArcSweep(profile, arc, { textureMeters: 4 })
}

/** The round patch a landmark stands on; a tree's crown keeps `TREE_ROOM` m clear of it. */
export const TREE_ROOM = 8

export type Clearing = { x: number; z: number; radius: number }

/**
 * True where the garden has no room for a tree: the field and the hedge, the home-run lawn and the terrace past it, the
 * stands and the foul ground in front of them, behind home, past the outer hedge, and in `clearings`.
 */
export function isBuiltUp(x: number, z: number, clearings: readonly Clearing[]) {
  const spray = sprayOf(x, z)
  const distance = Math.hypot(x, z)
  if (Math.abs(spray) <= FOUL_ANGLE + 0.05 && distance < fenceDistance(spray) + 8) return true
  if (isOnHomeRunLawn(x, z) || distance < 48 || distance > outerHedgeDistance(spray) - 7) return true
  if (Math.abs(spray) < TERRACE.outer + 0.05 && distance > TERRACE.front - TREE_ROOM) return true
  if ([-1, 1].some((side) => isInStands(x, z, side))) return true
  return clearings.some((clearing) => Math.hypot(clearing.x - x, clearing.z - z) < clearing.radius + TREE_ROOM)
}

/** Within the stands, or the foul ground between them and their foul line, on `side` (1 is first base). */
export function isInStands(x: number, z: number, side: number) {
  const offset = (x * side + z) * Math.SQRT1_2
  const along = (x * side - z) * Math.SQRT1_2
  return offset > -3 && offset < STANDS.offset + STANDS_DEPTH + 4 && along > -8 && along < STANDS.lineLength + 8
}

/** Town trees grown to a ballpark's scale. */
export const GARDEN_TREE_SCALE = { minimum: 2, spread: 0.9 }

/**
 * The park's trees as town trees, so they take the season's colors and snow like the town's: a row just outside the
 * outer hedge, peeking over it, and round garden trees between it and the stands. Seeded, so they never move.
 */
export function gardenTrees(clearings: readonly Clearing[]): TownObject[] {
  const ringTrees = Array.from({ length: 96 }, (_, index) => {
    const spray = ((index + seededFraction(index, 51) * 0.6) / 96) * Math.PI * 2 - Math.PI
    const [x, , z] = sweptPoint(spray, outerHedgeDistance(spray) + 9 + seededFraction(index, 52) * 16, 0)
    return { x, z, index }
  })
  const gardenSpots = Array.from({ length: 700 }, (_, index) => {
    const spray = seededFraction(index, 53) * Math.PI * 2 - Math.PI
    const [x, , z] = sweptPoint(spray, 40 + Math.sqrt(seededFraction(index, 54)) * 180, 0)
    return { x, z, index: index + 96 }
  })
    .filter((spot) => !isBuiltUp(spot.x, spot.z, clearings))
    .slice(0, 64)
  return [...ringTrees, ...gardenSpots].map(({ x, z, index }) => ({
    id: `ballpark-tree-${index}`,
    type: 'tree',
    position: { x, y: 0, z },
    rotation: seededFraction(index, 55) * Math.PI * 2,
    scale: GARDEN_TREE_SCALE.minimum + seededFraction(index, 56) * GARDEN_TREE_SCALE.spread,
  }))
}

export const HILL_COUNT = 20

/** Low rolling hills on the horizon, hiding the lawn's far edge in every direction. */
export function setHill(dummy: Object3D, index: number) {
  const spray = ((index + seededFraction(index, 61) * 0.5) / HILL_COUNT) * Math.PI * 2
  const [x, , z] = sweptPoint(spray, 252 + seededFraction(index, 62) * 22, 0)
  dummy.position.set(x, -4, z)
  dummy.rotation.set(0, spray, 0)
  dummy.scale.set(34 + seededFraction(index, 63) * 16, 14 + seededFraction(index, 64) * 12, 26)
}

/** The same hills a little larger, for the snow that settles on them. */
export function setHillSnow(dummy: Object3D, index: number) {
  setHill(dummy, index)
  dummy.scale.multiplyScalar(1.01)
}

export const CLOUD_COUNT = 12
export const PUFFS_PER_CLOUD = 4

/** Soft clouds far out round the park, high enough to sit over the hedge and the hills in a wide shot. */
export function setCloudPuff(dummy: Object3D, index: number) {
  const cloud = Math.floor(index / PUFFS_PER_CLOUD)
  const puff = index % PUFFS_PER_CLOUD
  const spray = ((cloud + seededFraction(cloud, 71)) / CLOUD_COUNT) * Math.PI * 2
  const size = 3 + seededFraction(cloud, 72) * 2
  const [x, , z] = sweptPoint(spray, 175 + seededFraction(cloud, 73) * 60, 0)
  const across = (puff - 1.5) * 2.5 * size
  dummy.position.set(
    x + Math.cos(spray) * across,
    48 + seededFraction(cloud, 74) * 30 + Math.sin(puff * 2 + cloud) * 0.6 * size,
    z + Math.sin(spray) * across,
  )
  dummy.rotation.set(0, -spray, 0)
  dummy.scale.set(4.2 * size, (1.6 + (puff % 2) * 0.5) * size, 2.8 * size)
}

/** The flower beds in foul ground, between each foul line and its stands. */
export const FLOWER_BED = { length: 6, width: 1.4, height: 0.3, off: 6, first: 32, gap: 7.5, perSide: 6 }

export type FlowerBed = { x: number; z: number; yaw: number; side: number; along: number }

export function flowerBeds(): FlowerBed[] {
  return [-1, 1].flatMap((side) =>
    Array.from({ length: FLOWER_BED.perSide }, (_, index) => {
      const along = FLOWER_BED.first + index * FLOWER_BED.gap
      const [x, , z] = sweptPoint(side * FOUL_ANGLE, along, 0)
      return {
        x: x + side * Math.SQRT1_2 * FLOWER_BED.off,
        z: z + Math.SQRT1_2 * FLOWER_BED.off,
        yaw: -side * FOUL_ANGLE,
        side,
        along,
      }
    }),
  )
}

export function setFlowerBed(dummy: Object3D, bed: FlowerBed) {
  dummy.position.set(bed.x, FLOWER_BED.height / 2, bed.z)
  dummy.rotation.set(0, bed.yaw, 0)
  dummy.scale.set(1, 1, 1)
}

/**
 * Town flowers in two rows down each bed, and in clumps on the lawn beyond the outfield hedge, so they close up under
 * snow like the town's.
 */
export function gardenFlowers(): TownObject[] {
  const inBeds = flowerBeds().flatMap((bed, bedIndex) =>
    Array.from({ length: 10 }, (_, index) => {
      const along = ((index % 5) / 4 - 0.5) * (FLOWER_BED.length - 0.8)
      const across = (Math.floor(index / 5) - 0.5) * 0.6
      const lineX = Math.sin(bed.side * FOUL_ANGLE)
      const lineZ = -Math.cos(bed.side * FOUL_ANGLE)
      return {
        x: bed.x + lineX * along - lineZ * across,
        z: bed.z + lineZ * along + lineX * across,
        index: bedIndex * 10 + index,
      }
    }),
  )
  const clumps = Array.from({ length: 20 }, (_, clump) => {
    const spray = (seededFraction(clump, 81) - 0.5) * 2 * HOME_RUN_LAWN.spray
    return sweptPoint(spray, fenceDistance(spray) + 6 + seededFraction(clump, 82) * 60, 0)
  })
  const onLawn = clumps.flatMap(([x, , z], clump) =>
    Array.from({ length: 4 }, (_, index) => ({
      x: x + (seededFraction(clump * 4 + index, 83) - 0.5) * 3,
      z: z + (seededFraction(clump * 4 + index, 84) - 0.5) * 3,
      index: 1000 + clump * 4 + index,
    })),
  )
  return [...inBeds, ...onLawn].map(({ x, z, index }) => ({
    id: `ballpark-flower-${index}`,
    type: 'flower',
    position: { x, y: 0, z },
    rotation: seededFraction(index, 85) * Math.PI * 2,
    scale: index < 1000 ? 1 : 1.5,
  }))
}

/** Stepping stones from each dugout out toward the outfield corner, through foul ground. */
export function steppingStones() {
  const paths = [-1, 1].flatMap((side) => [
    [side * 19.5, -6.5, side * 25, -13.5],
    [side * 27, -17.5, side * 33, -26],
  ])
  return paths.flatMap(([fromX, fromZ, toX, toZ], path) => {
    const length = Math.hypot(toX - fromX, toZ - fromZ)
    return Array.from({ length: Math.floor(length / 1.25) + 1 }, (_, step) => {
      const amount = (step * 1.25) / length
      const seed = path * 40 + step
      return {
        x: fromX + (toX - fromX) * amount + (seededFraction(seed, 91) - 0.5) * 0.3,
        z: fromZ + (toZ - fromZ) * amount + (seededFraction(seed, 92) - 0.5) * 0.3,
        yaw: seededFraction(seed, 93) * 3,
        width: 0.5 + seededFraction(seed, 94) * 0.15,
        depth: 0.42 + seededFraction(seed, 95) * 0.12,
      }
    })
  })
}
