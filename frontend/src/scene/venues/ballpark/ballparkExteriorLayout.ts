import {
  CatmullRomCurve3,
  CircleGeometry,
  CylinderGeometry,
  LatheGeometry,
  Shape,
  ShapeGeometry,
  SphereGeometry,
  TorusGeometry,
  TubeGeometry,
  Vector2,
  Vector3,
} from 'three'
import { seededFraction } from '../../../motionMath'
import {
  blossomFrame,
  box,
  corgiParts,
  type FlowerTower,
  leafySphere,
  mergeParts,
  partMatrix,
  type PlacedPart,
  placeInFrame,
  scaleUvs,
  towerBlossomParts,
  towerGreenParts,
  towerLampParts,
  type Triple,
  unitSphere,
} from './ballparkParts'

// The garden ballpark as the town sees it, in its slot's frame (venueSlots.ts): the gate's center on the hedge line
// at the origin, the town toward +z. A flower-hedge arch with the park's sign stands in the town hedge's opening; past
// a forecourt, the hall fills the gap in a hedge bowl, with a glass conservatory behind it, corgi topiaries either
// side, and flower-stem light towers, whose height is what carries through the fog. It keeps to its slot (70 × 36 m);
// the stadium's own bowl is only inside /baseball. Static parts are merged into one geometry per material.

/** The gate's two hedge pillars and the flattened arch between them, on the town hedge's line. */
export const EXTERIOR_GATE = { pillarX: 4.1, pillarHeight: 3.5, archRise: 2.1, archRadius: 0.42, line: -0.1 }
/** The hedge bowl: its outer radius, wall thickness and height, its front's distance, and its reach either side. */
export const EXTERIOR_BOWL = { radius: 30, thickness: 2.4, height: 6.4, front: -8, reach: 1.3 }
export const EXTERIOR_HALL = { width: 13.4, height: 7.2, depth: 1.2, z: -8.8 }
export const HALL_FRONT = EXTERIOR_HALL.z + EXTERIOR_HALL.depth / 2
export const HALL_DOORS = [
  { x: -4.2, size: 1 },
  { x: 0, size: 1.25 },
  { x: 4.2, size: 1 },
]
export const EXTERIOR_DOME = { radius: 6, squash: 0.8, base: 5.4, z: -16.5 }
export const EXTERIOR_CORGIS = [
  { x: -10, z: -7.4, yaw: 0.3 },
  { x: 10, z: -7.4, yaw: -0.3 },
]
export const CORGI_SCALE = 0.52
/** The light towers, drawn at `TOWER_SCALE` of the stadium's; every other one takes the roof color for its petals. */
export const EXTERIOR_TOWERS = [
  { x: -17, z: -18, height: 17, colorful: true },
  { x: 17, z: -18, height: 17, colorful: false },
  { x: -27, z: -30, height: 20, colorful: false },
  { x: 27, z: -30, height: 20, colorful: true },
]
export const TOWER_SCALE = 0.65
/** The park's sign, hung from the arch on two ropes. */
export const EXTERIOR_SIGN = { height: 0.8, at: [0, 4.3, EXTERIOR_GATE.line + 0.2] as [number, number, number] }
/** The forecourt between the gate and the hall, a little under the town's ground so the two never flicker. */
export const EXTERIOR_FORECOURT = { width: 14, near: 0.4, far: HALL_FRONT, y: -0.03 }
/** Garden flowers: pink, cream, butter, lilac, coral, and blush. */
export const BLOOM_COLORS = ['#eeb0a5', '#f8f3e7', '#f2dc92', '#b9a3c9', '#ca7765', '#f3c6d0']

export type ExteriorTower = (typeof EXTERIOR_TOWERS)[number]
export type Bloom = { x: number; y: number; z: number; size: number; color: string }

/** A point along the arch, from the left pillar's top (0) over to the right one's (1), `lift` m above its line. */
export function archPoint(progress: number, lift = 0) {
  const angle = Math.PI * (1 - progress)
  const { pillarX, pillarHeight, archRise, line } = EXTERIOR_GATE
  return new Vector3(Math.cos(angle) * pillarX, pillarHeight + Math.sin(angle) * (archRise + lift), line)
}

/** The bowl wall's cross-section, out from its inner face and up, evenly spaced so its leaves keep their size. */
export function bowlProfile() {
  const { radius, thickness, height } = EXTERIOR_BOWL
  const inner = radius - thickness
  const side = [0, 0.25, 0.5, 0.75, 1].map((step) => step * (height - 0.6))
  return [
    ...side.map((up) => new Vector2(inner, up)),
    new Vector2(inner + 0.4, height + 0.1),
    new Vector2(inner + 1.2, height + 0.5),
    new Vector2(inner + 2, height + 0.1),
    ...[...side].reverse().map((up) => new Vector2(radius, up)),
  ]
}

/** The snow lying along the bowl's trimmed top in winter. */
export function bowlSnowProfile() {
  const inner = EXTERIOR_BOWL.radius - EXTERIOR_BOWL.thickness
  const { height } = EXTERIOR_BOWL
  return [
    new Vector2(inner + 0.3, height + 0.18),
    new Vector2(inner + 1.2, height + 0.62),
    new Vector2(inner + 2.1, height + 0.18),
  ]
}

/** How far round from its front the bowl's gap reaches: just inside the hall, which hides the walls' ends. */
export function bowlGapAngle() {
  return Math.asin((EXTERIOR_HALL.width / 2 - 0.5) / EXTERIOR_BOWL.radius)
}

/**
 * The bowl's two walls, from the hall's sides round toward the back, as `profile` swept round its center. Its leaves
 * repeat about every 3 m along the wall and over its 15 m profile, like the stadium's hedge.
 */
export function bowlWallParts(profile: Vector2[]): PlacedPart[] {
  const { radius, reach, front } = EXTERIOR_BOWL
  const gap = bowlGapAngle()
  const sweep = reach - gap
  return [gap, -reach].map((start) => ({
    geometry: scaleUvs(new LatheGeometry(profile, 48, start, sweep), (radius * sweep) / 3, 5),
    at: [0, 0, front - radius] as Triple,
  }))
}

/** The gate's hedge: both pillars with a ball on each, and the arch between their tops. */
export function gateHedgeParts(): PlacedPart[] {
  const { pillarX, pillarHeight, archRadius, line } = EXTERIOR_GATE
  const arch = new CatmullRomCurve3(Array.from({ length: 25 }, (_, step) => archPoint(step / 24)))
  return [
    ...[-1, 1].flatMap((side) => [
      {
        geometry: scaleUvs(new CylinderGeometry(0.62, 0.72, pillarHeight, 18), 1.5, 1.2),
        at: [side * pillarX, pillarHeight / 2, line] as Triple,
      },
      { geometry: leafySphere, at: [side * pillarX, pillarHeight + 0.35, line] as Triple, size: 0.72 },
    ]),
    { geometry: scaleUvs(new TubeGeometry(arch, 48, archRadius, 12), 3.3, 0.9) },
  ]
}

/** An arched doorway 2.6 m wide, its sides 2.6 m up to where the arch springs. */
export function doorwayGeometry() {
  const doorway = new Shape()
    .moveTo(-1.3, 0)
    .lineTo(1.3, 0)
    .lineTo(1.3, 2.6)
    .absarc(0, 2.6, 1.3, 0, Math.PI, false)
    .lineTo(-1.3, 0)
  return new ShapeGeometry(doorway, 12)
}

/** The round windows over the side doors. */
export const HALL_WINDOWS = [-4.2, 4.2].map((x) => ({ x, y: 5.6 }))

/** The dome's height over the ground at its crown. */
export const DOME_CROWN = EXTERIOR_DOME.base + EXTERIOR_DOME.radius * EXTERIOR_DOME.squash

/** A tower's frame: at its foot, at `TOWER_SCALE`. */
export function towerFrame(tower: ExteriorTower) {
  return partMatrix({ at: [tower.x, 0, tower.z], size: TOWER_SCALE })
}

/** The tower in its own frame, its blossom facing the bowl's middle like the stadium's face the field. */
export function framedTower(tower: ExteriorTower): FlowerTower {
  const bowlMiddle = new Vector3(-tower.x, 0, EXTERIOR_BOWL.front - EXTERIOR_BOWL.radius - tower.z)
  return { x: 0, z: 0, height: tower.height / TOWER_SCALE, target: bowlMiddle.divideScalar(TOWER_SCALE) }
}

export function towerParts(parts: (tower: FlowerTower) => PlacedPart[], towers: readonly ExteriorTower[]) {
  return towers.flatMap((tower) => placeInFrame(parts(framedTower(tower)), towerFrame(tower)))
}

/** Where each tower lamp's glow is painted, just in front of its face. */
export function towerGlowSpots() {
  return EXTERIOR_TOWERS.map((tower) =>
    new Vector3(0, 1.4, 0).applyMatrix4(towerFrame(tower).multiply(blossomFrame(framedTower(tower)))),
  )
}

/** Where the doors' and windows' glow is painted at night, just in front of the hall. */
export function hallGlowSpots() {
  const front = HALL_FRONT + 0.6
  return [
    ...HALL_DOORS.map((door) => new Vector3(door.x, 2.4 * door.size, front)),
    ...HALL_WINDOWS.map((window) => new Vector3(window.x, window.y, front)),
  ]
}

export function corgiFrames() {
  return EXTERIOR_CORGIS.map((corgi) =>
    partMatrix({ at: [corgi.x, 0, corgi.z], turn: [0, corgi.yaw, 0], size: CORGI_SCALE }),
  )
}

/** One kind of the corgi topiary's parts, for both corgis. */
export function bothCorgis(parts: readonly PlacedPart[]) {
  return corgiFrames().flatMap((frame) => placeInFrame(parts, frame))
}

/** Four blooms of one color round `center`, scattered by `seed`. */
export function bloomCluster(seed: number, [x, y, z]: Triple, spread: number, size: number): Bloom[] {
  const color = BLOOM_COLORS[Math.floor(seededFraction(seed, 1) * BLOOM_COLORS.length)]
  return Array.from({ length: 4 }, (_, index) => ({
    x: x + (seededFraction(seed, 10 + index) - 0.5) * spread * 2,
    y: y + (seededFraction(seed, 20 + index) - 0.5) * spread,
    z: z + (seededFraction(seed, 30 + index) - 0.5) * spread * 2,
    size: size * (0.75 + seededFraction(seed, 40 + index) * 0.5),
    color,
  }))
}

/** The flowers grown into the gate's pillars and arch, and along the bowl's outer face. */
export function exteriorBlooms(): Bloom[] {
  const { pillarX, pillarHeight, line } = EXTERIOR_GATE
  const pillars = Array.from({ length: 32 }, (_, index) => {
    const around = seededFraction(index, 2) * Math.PI * 2
    const side = index % 2 === 0 ? -1 : 1
    const at: Triple = [
      side * pillarX + Math.sin(around) * 0.72,
      0.4 + seededFraction(index, 3) * (pillarHeight - 0.4),
      line + Math.cos(around) * 0.72,
    ]
    return bloomCluster(index, at, 0.18, 0.16)
  })
  const arch = Array.from({ length: 40 }, (_, index) => {
    const point = archPoint(seededFraction(index, 4), 0.25)
    const at: Triple = [point.x, point.y, point.z + (seededFraction(index, 5) - 0.5) * 0.8]
    return bloomCluster(100 + index, at, 0.2, 0.15)
  })
  const { radius, height, front } = EXTERIOR_BOWL
  const gap = bowlGapAngle()
  const wall = Array.from({ length: 64 }, (_, index) => {
    const side = index % 2 === 0 ? -1 : 1
    const angle = side * (gap + 0.03 + seededFraction(index, 6) * (EXTERIOR_BOWL.reach - gap - 0.06))
    const at: Triple = [
      Math.sin(angle) * (radius + 0.05),
      0.8 + seededFraction(index, 7) * (height - 1.6),
      front - radius + Math.cos(angle) * (radius + 0.05),
    ]
    return bloomCluster(200 + index, at, 0.42, 0.26)
  })
  return [...pillars, ...arch, ...wall].flat()
}

/** The exterior merged into one geometry per material it is drawn in. */
export function createExteriorGeometries() {
  const front = HALL_FRONT
  const { width, height, depth, z } = EXTERIOR_HALL
  const dome = EXTERIOR_DOME
  const crown = DOME_CROWN
  const corgi = corgiParts()
  const domeAt: Triple = [0, dome.base, dome.z]
  const squash: Triple = [1, dome.squash, 1]
  const doorTrim = new TorusGeometry(1.36, 0.14, 8, 20, Math.PI)
  const doorway = doorwayGeometry()
  const ropes = [-1.4, 1.4].map((x) => ({
    geometry: new CylinderGeometry(0.03, 0.03, 0.75, 6),
    at: [x, 5.1, EXTERIOR_SIGN.at[2]] as Triple,
  }))
  const towersOf = (colorful: boolean) => EXTERIOR_TOWERS.filter((tower) => tower.colorful === colorful)
  const petals = (colored: boolean) => (tower: FlowerTower) => towerBlossomParts(tower, colored)
  return {
    hedge: mergeParts([...gateHedgeParts(), ...bowlWallParts(bowlProfile()), ...bothCorgis(corgi.hedge)]),
    bowlSnow: mergeParts(bowlWallParts(bowlSnowProfile())),
    greens: mergeParts(towerParts(towerGreenParts, EXTERIOR_TOWERS)),
    walls: mergeParts([
      box([0, height / 2, z], [width, height, depth]),
      {
        geometry: new CylinderGeometry(dome.radius, dome.radius, dome.base, 40, 1, true),
        at: [0, dome.base / 2, dome.z],
      },
    ]),
    roof: mergeParts([
      box([0, height, z], [width + 0.6, 0.6, depth + 0.4]),
      ...bothCorgis(corgi.collar),
      ...towerParts(petals(true), towersOf(true)),
    ]),
    trim: mergeParts([
      ...HALL_DOORS.map((door) => ({
        geometry: doorTrim,
        at: [door.x, 2.6 * door.size, front + 0.06] as Triple,
        size: door.size,
      })),
      ...HALL_WINDOWS.map((window) => ({
        geometry: new TorusGeometry(0.82, 0.12, 8, 24),
        at: [window.x, window.y, front + 0.06] as Triple,
      })),
      ...[0, 1, 2, 3].map((rib) => ({
        geometry: new TorusGeometry(dome.radius + 0.03, 0.1, 6, 32, Math.PI),
        at: domeAt,
        turn: [0, (rib * Math.PI) / 4, 0] as Triple,
        size: squash,
      })),
      { geometry: new TorusGeometry(dome.radius + 0.05, 0.16, 6, 48), at: domeAt, turn: [Math.PI / 2, 0, 0] },
      { geometry: new SphereGeometry(1.1, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2), at: [0, crown - 0.15, dome.z] },
      ...ropes,
      ...towerParts(petals(false), EXTERIOR_TOWERS),
    ]),
    accent: mergeParts([
      { geometry: unitSphere, at: [0, crown + 1.15, dome.z], size: 0.35 },
      ...bothCorgis(corgi.tag),
      ...towerParts(petals(true), towersOf(false)),
    ]),
    doors: mergeParts([
      ...HALL_DOORS.map((door) => ({ geometry: doorway, at: [door.x, 0.02, front + 0.02] as Triple, size: door.size })),
      ...HALL_WINDOWS.map((window) => ({
        geometry: new CircleGeometry(0.75, 24),
        at: [window.x, window.y, front + 0.02] as Triple,
      })),
    ]),
    glass: mergeParts([
      {
        geometry: scaleUvs(new SphereGeometry(dome.radius, 40, 14, 0, Math.PI * 2, 0, Math.PI / 2), 8, 4),
        at: domeAt,
        size: squash,
      },
    ]),
    lamps: mergeParts(towerParts(towerLampParts, EXTERIOR_TOWERS)),
    orange: mergeParts(bothCorgis(corgi.orange)),
    cream: mergeParts(bothCorgis(corgi.cream)),
    ink: mergeParts(bothCorgis(corgi.ink)),
  }
}

/** The hall's cornice snow, as a house's roof snow: centered on the hall, resting on the cornice. */
export const CORNICE_SNOW = { at: [0, 0, EXTERIOR_HALL.z] as Triple, rest: EXTERIOR_HALL.height + 0.3 }

export function corniceSnowGeometry() {
  return mergeParts([
    box([0, EXTERIOR_HALL.height + 0.38, 0], [EXTERIOR_HALL.width + 0.5, 0.16, EXTERIOR_HALL.depth + 0.3]),
  ])
}
