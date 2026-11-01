import {
  BufferGeometry,
  Float32BufferAttribute,
  type Group,
  type Mesh,
  type MeshStandardMaterial,
  Path,
  Shape,
} from 'three'
import type { BallparkColorRole } from '../../data/models'
import { BASES, FENCE_DISTANCE, FENCE_HEIGHT, fenceDistance, FOUL_ANGLE, MOUND_DISTANCE } from '../game/field'

// The stadium as drawn, in the field meters of baseball/game/field.ts: home plate's center at the origin, the pitcher
// toward -z, first base on +x. Flat shapes are drawn in their own (x, y) plane, y toward the pitcher, and laid down.
// Nothing here is judged: the hedge only has to stand where the judge's fence is, so a home run clears what is drawn.

export const MOUND = { height: 0.25, topRadius: 2.4, baseRadius: 2.9 }
/** The grass reaches past the fog, so the field never shows an edge. */
export const GROUND_RADIUS = 260
export const HEDGE_DEPTH = 2.4
export const WARNING_TRACK_WIDTH = 4.2
/** Flat layers from the grass up, a couple of centimeters apart so none of them flickers through another. */
export const FIELD_LAYERS = { snow: 0.01, dirt: 0.02, baseDirt: 0.025, chalk: 0.035 }

/** The infield dirt runs along both foul lines out to an arc around the mound; the infield grass is cut out of it. */
export const INFIELD = {
  arcRadius: 29,
  homeRadius: 4.6,
  baseRadius: 2.9,
  grass: { home: 3.8, side: 16.6, middle: 19.4, second: 35.4 },
}

/** How far along a foul line it meets a circle of `radius` around the mound. */
export function foulLineMeetsArc(radius: number) {
  return (MOUND_DISTANCE + Math.sqrt(2 * radius * radius - MOUND_DISTANCE * MOUND_DISTANCE)) / 2
}

export function createInfieldShape() {
  const { arcRadius, grass } = INFIELD
  const meet = foulLineMeetsArc(arcRadius)
  const arcStart = Math.atan2(meet - MOUND_DISTANCE, meet)
  const shape = new Shape()
    .moveTo(0, -1.2)
    .lineTo(meet, meet)
    .absarc(0, MOUND_DISTANCE, arcRadius, arcStart, Math.PI - arcStart, false)
    .lineTo(0, -1.2)
  const infieldGrass = new Path()
    .moveTo(0, grass.home)
    .lineTo(-grass.side, grass.middle)
    .lineTo(0, grass.second)
    .lineTo(grass.side, grass.middle)
    .lineTo(0, grass.home)
  shape.holes.push(infieldGrass)
  return shape
}

/** Home plate, 43 cm across, its point toward the catcher. */
export function createHomePlateShape() {
  const half = 0.215
  return new Shape()
    .moveTo(-half, half)
    .lineTo(half, half)
    .lineTo(half, 0)
    .lineTo(0, -half)
    .lineTo(-half, 0)
    .lineTo(-half, half)
}

export const BASE_SPOTS = [BASES.first, BASES.second, BASES.third]

/** A chalk stripe lying on the field: its center, width across, length along, and yaw. */
export type ChalkLine = { x: number; z: number; width: number; length: number; yaw: number }

/** The foul lines out to the hedge and both batter's boxes, 15 cm off the plate. */
export function chalkLines(): ChalkLine[] {
  const foulLines = [-1, 1].map((side) => {
    const angle = side * FOUL_ANGLE
    const length = fenceDistance(angle)
    return {
      x: Math.sin(angle) * (length / 2),
      z: -Math.cos(angle) * (length / 2),
      width: 0.1,
      length,
      yaw: -angle,
    }
  })
  const boxes = [-1, 1].flatMap((side) => [
    { x: side * 0.365, z: 0, width: 0.06, length: 1.83, yaw: 0 },
    { x: side * 1.585, z: 0, width: 0.06, length: 1.83, yaw: 0 },
    { x: side * 0.975, z: -0.915, width: 1.28, length: 0.06, yaw: 0 },
    { x: side * 0.975, z: 0.915, width: 1.28, length: 0.06, yaw: 0 },
  ])
  return [...foulLines, ...boxes]
}

/** A swept profile's cross-section: out from the arc it is swept along, and up. */
export type SweepProfile = readonly (readonly [out: number, up: number])[]

/** The hedge's cross-section, out from the fence line and up: trimmed flat on top with rounded edges. */
export const HEDGE_PROFILE: SweepProfile = [
  [0, 0],
  [0, FENCE_HEIGHT - 0.45],
  [0.12, FENCE_HEIGHT - 0.14],
  [0.45, FENCE_HEIGHT],
  [HEDGE_DEPTH - 0.45, FENCE_HEIGHT],
  [HEDGE_DEPTH - 0.12, FENCE_HEIGHT - 0.14],
  [HEDGE_DEPTH, FENCE_HEIGHT - 0.45],
  [HEDGE_DEPTH, 0],
]

/** The snow that settles on the hedge's flat top in winter. */
export const HEDGE_SNOW_PROFILE: SweepProfile = [
  [0.4, FENCE_HEIGHT - 0.02],
  [0.55, FENCE_HEIGHT + 0.09],
  [HEDGE_DEPTH - 0.55, FENCE_HEIGHT + 0.09],
  [HEDGE_DEPTH - 0.4, FENCE_HEIGHT - 0.02],
]

export const WARNING_TRACK_PROFILE: SweepProfile = [
  [-WARNING_TRACK_WIDTH, FIELD_LAYERS.dirt],
  [0, FIELD_LAYERS.dirt],
]

export const FENCE_STEPS = 120

/**
 * Where and how finely a profile is swept: between two spray angles (around home plate, radians, plus = right field)
 * in `steps`, its first point `radiusAt(spray)` from home. UVs are meters over `textureMeters`, the arc's run measured
 * at `textureRadius`, so a texture tiles at about the same size all along.
 */
export type ArcSweep = {
  from: number
  to: number
  steps: number
  radiusAt: (spray: number) => number
  textureRadius: number
}

/**
 * `profile` swept along the fence from one foul pole to the other, its first point on the fence line; the faces look
 * toward home plate and up. `caps` closes both ends with the profile, which must then be convex.
 */
export function createFenceSweep(profile: SweepProfile, { caps = false, textureMeters = 3 } = {}) {
  const arc = {
    from: -FOUL_ANGLE,
    to: FOUL_ANGLE,
    steps: FENCE_STEPS,
    radiusAt: fenceDistance,
    textureRadius: FENCE_DISTANCE.center,
  }
  return createArcSweep(profile, arc, { caps, textureMeters })
}

/** `profile` swept along `arc`, its faces toward home plate and up when the profile runs out and up. */
export function createArcSweep(profile: SweepProfile, arc: ArcSweep, { caps = false, textureMeters = 3 } = {}) {
  const sprays = Array.from({ length: arc.steps + 1 }, (_, step) => arc.from + ((arc.to - arc.from) * step) / arc.steps)
  const along = profileDistances(profile)
  const ring = profile.length
  const positions = sprays.flatMap((spray) =>
    profile.flatMap(([out, up]) => sweptPoint(spray, arc.radiusAt(spray) + out, up)),
  )
  const uvs = sprays.flatMap((spray) =>
    along.flatMap((distance) => [(spray * arc.textureRadius) / textureMeters, distance / textureMeters]),
  )
  const sides = Array.from({ length: arc.steps }, (_, step) => sweepQuads(step, ring)).flat()
  const ends = caps ? [...capFan(0, ring, false), ...capFan(arc.steps * ring, ring, true)] : []
  const geometry = new BufferGeometry()
  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3))
  geometry.setAttribute('uv', new Float32BufferAttribute(uvs, 2))
  geometry.setIndex([...sides, ...ends])
  geometry.computeVertexNormals()
  return geometry
}

/** The field point `radius` m from home plate at `spray`, `up` m high. */
export function sweptPoint(spray: number, radius: number, up: number) {
  return [Math.sin(spray) * radius, up, -Math.cos(spray) * radius]
}

/** How far along the profile each of its points is, for the texture's second coordinate. */
export function profileDistances(profile: SweepProfile) {
  return profile.map((_, index) =>
    profile
      .slice(1, index + 1)
      .reduce((total, [out, up], step) => total + Math.hypot(out - profile[step][0], up - profile[step][1]), 0),
  )
}

/** Two triangles per profile segment between sweep step `step` and the next, counterclockwise seen from home. */
export function sweepQuads(step: number, ring: number) {
  return Array.from({ length: ring - 1 }, (_, point) => {
    const here = step * ring + point
    const next = here + ring
    return [here, next, here + 1, next, next + 1, here + 1]
  }).flat()
}

/** A fan over the ring starting at `first`; the far end's turns the other way so both caps face out. */
export function capFan(first: number, ring: number, far: boolean) {
  return Array.from({ length: ring - 2 }, (_, point) => {
    const corner = first + point + 1
    return far ? [first, corner + 1, corner] : [first, corner, corner + 1]
  }).flat()
}

/** Where the foul poles stand: at the hedge's two ends, in the middle of its depth. */
export function foulPoleSpots() {
  return [-1, 1].map((side) => {
    const radius = fenceDistance(FOUL_ANGLE) + HEDGE_DEPTH / 2
    return { x: Math.sin(side * FOUL_ANGLE) * radius, z: -Math.cos(side * FOUL_ANGLE) * radius }
  })
}

export const FOUL_POLE = { height: 14, radius: 0.15, capRadius: 0.42 }

/** The two dugouts in foul ground beside the baselines, their open fronts (local +z) toward the infield. */
export const DUGOUT_SPOTS = [
  { x: -16.3, z: -2.1, yaw: (3 * Math.PI) / 4 },
  { x: 16.3, z: -2.1, yaw: (-3 * Math.PI) / 4 },
]

/** One box of a dugout in its own frame (front +z): the building role that colors it, its center, size, and tilt. */
export type DugoutPart = {
  role: BallparkColorRole
  center: readonly [x: number, y: number, z: number]
  size: readonly [width: number, height: number, depth: number]
  tilt: number
}

/** A garden shed open to the field under a roof sloping toward it: every building role colors part of it. */
export const DUGOUT_PARTS: readonly DugoutPart[] = [
  { role: 'walls', center: [0, 1.4, -1.5], size: [8, 2.8, 0.2], tilt: 0 },
  { role: 'walls', center: [-3.9, 1.3, 0], size: [0.2, 2.6, 3], tilt: 0 },
  { role: 'walls', center: [3.9, 1.3, 0], size: [0.2, 2.6, 3], tilt: 0 },
  { role: 'walls', center: [0, 0.45, 1.4], size: [8, 0.9, 0.2], tilt: 0 },
  { role: 'roof', center: [0, 2.78, 0.1], size: [8.8, 0.18, 3.8], tilt: 0.13 },
  { role: 'trim', center: [0, 0.95, 1.4], size: [8.1, 0.1, 0.34], tilt: 0 },
  { role: 'trim', center: [0, 2.48, 1.98], size: [8.9, 0.24, 0.12], tilt: 0 },
  ...[-3.9, -1.3, 1.3, 3.9].map((x) => ({
    role: 'trim' as const,
    center: [x, 1.7, 1.4] as const,
    size: [0.16, 1.6, 0.16] as const,
    tilt: 0,
  })),
  { role: 'accent', center: [0, 2.12, 1.56], size: [2.4, 0.42, 0.06], tilt: 0 },
  { role: 'accent', center: [0, 0.55, 1.52], size: [8, 0.16, 0.04], tilt: 0 },
]

/** Snow settles on the lawn and the hedge's top as the season's cover grows, and melts off as it shrinks. */
export function coverWithSnow(
  cover: number,
  lawnSnow: Mesh | null,
  lawnSnowMaterial: MeshStandardMaterial | null,
  hedgeSnow: Group | null,
) {
  const showing = cover > 0.001
  if (lawnSnow) lawnSnow.visible = showing
  if (lawnSnowMaterial) lawnSnowMaterial.opacity = Math.min(1, cover * 1.1)
  if (!hedgeSnow) return
  hedgeSnow.visible = showing
  hedgeSnow.scale.y = Math.max(0.001, cover)
}
