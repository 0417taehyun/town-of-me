import {
  BoxGeometry,
  BufferGeometry,
  CatmullRomCurve3,
  CircleGeometry,
  ConeGeometry,
  CylinderGeometry,
  Euler,
  Float32BufferAttribute,
  Matrix4,
  PlaneGeometry,
  Quaternion,
  Shape,
  ShapeGeometry,
  SphereGeometry,
  TorusGeometry,
  TubeGeometry,
  Vector3,
} from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import { seededFraction } from '../../motionMath'
import { getRoundedBox } from '../../scene/roundedBox'
import { fenceDistance, FOUL_ANGLE } from '../game/field'
import { type Clearing, sprayOf, STANDS, STANDS_DEPTH, STANDS_TOP, standCurve, standPoint } from './bowlLayout'
import { DUGOUT_SPOTS, foulPoleSpots, sweptPoint } from './fieldLayout'

// The garden's landmarks, in the field meters of fieldLayout.ts: the oak with its treehouse scoreboard beyond center
// field, the corgi and giant-ball topiaries, the flower-stem light towers, string lights over the stands and the
// dugouts, the distance signs on the hedge, and the garden-shed dugouts. Static pieces are merged into one geometry
// per material, so each costs a draw call or two however many parts it has.

export type Triple = readonly [number, number, number]

/** A shape placed in its landmark's frame: moved to `at`, turned by `turn` (XYZ radians), and scaled by `size`. */
export type PlacedPart = { geometry: BufferGeometry; at?: Triple; turn?: Triple; size?: Triple | number }

export function partMatrix({ at = [0, 0, 0], turn = [0, 0, 0], size = 1 }: Omit<PlacedPart, 'geometry'>) {
  const scale = typeof size === 'number' ? new Vector3(size, size, size) : new Vector3(...size)
  return new Matrix4().compose(new Vector3(...at), new Quaternion().setFromEuler(new Euler(...turn)), scale)
}

/** The parts as one geometry, each moved into place and then all by `frame`. */
export function mergeParts(parts: readonly PlacedPart[], frame = new Matrix4()) {
  // Some shapes come indexed and some not (rounded boxes); merged geometry must be all one or the other.
  const placed = parts.map((part) => unindexed(part.geometry).applyMatrix4(frame.clone().multiply(partMatrix(part))))
  return mergeGeometries(placed) ?? new BufferGeometry()
}

export function unindexed(geometry: BufferGeometry) {
  return geometry.index ? geometry.toNonIndexed() : geometry.clone()
}

/** Faces home plate from `x`, `z`: the yaw that turns a landmark's front (+z) toward the plate. */
export function yawTowardHome(x: number, z: number) {
  return Math.atan2(-x, -z)
}

export function landmarkFrame(x: number, z: number, scale = 1) {
  return partMatrix({ at: [x, 0, z], turn: [0, yawTowardHome(x, z), 0], size: scale })
}

const unitSphere = new SphereGeometry(1, 16, 12)
/** A sphere whose leaf or flower texture repeats round it, so a big topiary's leaves stay leaf-sized. */
export const leafySphere = scaleUvs(new SphereGeometry(1, 16, 12), 3, 2)
const unitBox = new BoxGeometry(1, 1, 1)
const windowFrame = new TorusGeometry(0.5, 0.1, 8, 24)
const windowPane = new CircleGeometry(0.48, 20)

/** The oak stands on the outer hedge's line beyond center field, past every home run and the camera that lands one. */
export const OAK = { x: 0, z: -200, scale: 1.15 }
export const SCOREBOARD = { width: 19.6, height: 9.8, at: [0, 16.95, 4.7] as Triple }

/** The oak's bark: a trunk on spreading roots, and four limbs up into its crown. */
export function oakBarkParts(): PlacedPart[] {
  const roots = Array.from({ length: 6 }, (_, index) => {
    const angle = (index / 6) * Math.PI * 2 + 0.3
    return {
      geometry: unitSphere,
      at: [Math.sin(angle) * 3.2, 0.4, Math.cos(angle) * 3.2] as Triple,
      turn: [0, angle, 0] as Triple,
      size: [1.1, 0.9, 2.6] as Triple,
    }
  })
  const limbs = [
    [-1, 0.7],
    [1, 0.75],
    [-0.4, 0.3],
    [0.5, -0.4],
  ].map(([side, lean]) => ({
    geometry: new CylinderGeometry(0.7, 1, 1, 8),
    at: [side * 4.5, 26, lean * 2] as Triple,
    turn: [lean * 0.4, 0, -side * 0.75] as Triple,
    size: [0.9, 9, 0.9] as Triple,
  }))
  return [{ geometry: new CylinderGeometry(2.2, 3.4, 26, 16), at: [0, 13, 0] }, ...roots, ...limbs]
}

/** The oak's crown: round clumps kept above the scoreboard's awning, so leaves never cover the board. */
export function oakCrownParts(): PlacedPart[] {
  const clumps = Array.from({ length: 12 }, (_, index) => {
    const angle = seededFraction(index, 101) * Math.PI * 2
    const spread = 4 + seededFraction(index, 102) * 10
    return {
      geometry: unitSphere,
      at: [Math.sin(angle) * spread, 33 + seededFraction(index, 103) * 8, Math.cos(angle) * spread * 0.6 - 1] as Triple,
      size: 6 + seededFraction(index, 104) * 3,
    }
  })
  return [...clumps, { geometry: unitSphere, at: [0, 42, -1], size: 9 }]
}

export const OAK_SNOW = { at: [0, 49.5, -1] as Triple, size: [10, 3, 9] as Triple }

/** The treehouse in the ballpark's colors: its deck, posts, rails, and ladder take the accent. */
export function treehouseAccentParts(): PlacedPart[] {
  const posts = [-1.2, -0.45, 0.45, 1.2].map((angle) => post(Math.sin(angle) * 8, 1.5 + Math.cos(angle) * 8))
  const rails = Array.from({ length: 15 }, (_, index) => {
    const angle = -Math.PI / 2 - 0.15 + (index / 14) * (Math.PI + 0.3)
    return {
      geometry: unitBox,
      at: [Math.sin(angle) * 8.7, 12, 1.5 + Math.cos(angle) * 8.7] as Triple,
      size: [0.22, 1.6, 0.22] as Triple,
    }
  })
  const rungs = Array.from({ length: 13 }, (_, index) => ({
    geometry: unitBox,
    at: [12.4, 0.6 + index * 0.85, 4.4] as Triple,
    size: [1.4, 0.12, 0.12] as Triple,
  }))
  return [
    { geometry: new CylinderGeometry(9, 9, 0.7, 28, 1, false, -Math.PI / 2 - 0.2, Math.PI + 0.4), at: [0, 11, 1.5] },
    ...posts,
    post(10.5, 4.2),
    { geometry: unitBox, at: [10.5, 11.05, 2], size: [5.6, 0.5, 5.6] },
    ...rails,
    ...rungs,
  ]
}

export function post(x: number, z: number): PlacedPart {
  return { geometry: unitBox, at: [x, 5.5, z], size: [0.5, 11, 0.5] }
}

/** The scoreboard's frame and the gabled awning over it, and the little cabin's roof. */
export function treehouseRoofParts(): PlacedPart[] {
  const awning = [-1, 1].map((side) => ({
    geometry: getRoundedBox(23.5, 0.4, 4.2, 0.15),
    at: [0, 23.6, 4.2 + side * 1.54] as Triple,
    turn: [side * 0.75, 0, 0] as Triple,
  }))
  return [
    { geometry: getRoundedBox(21, 11, 0.9, 0.35), at: [0, 16.95, 4.2] },
    ...awning,
    { geometry: new ConeGeometry(3.6, 2.6, 4), at: [10.5, 16.1, 2], turn: [0, Math.PI / 4, 0] },
  ]
}

export function treehouseWallParts(): PlacedPart[] {
  return [{ geometry: getRoundedBox(4.2, 3.6, 4, 0.25), at: [10.5, 13.1, 2] }]
}

/** The cabin's round window frame. */
export function treehouseTrimParts(): PlacedPart[] {
  return [{ geometry: new TorusGeometry(0.78, 0.12, 8, 24), at: [10.5, 13.4, 4.05] }]
}

/** The lanterns round the deck, lamps that light up with the towers' at night. */
export function treehouseLanternParts(): PlacedPart[] {
  return Array.from({ length: 9 }, (_, index) => {
    const angle = -1.3 + (index / 8) * 2.6
    return {
      geometry: unitSphere,
      at: [Math.sin(angle) * 9.2, 10.2, 1.5 + Math.cos(angle) * 9.2] as Triple,
      size: 0.42,
    }
  })
}

export function treehouseGlassParts(): PlacedPart[] {
  return [{ geometry: new CircleGeometry(0.75, 20), at: [10.5, 13.4, 4.03] }]
}

/** The flower-stem light towers: beyond the fair balls' widest spray, past the stands' far ends, and behind them. */
export const LIGHT_TOWERS = [-1, 1].flatMap((side) =>
  [
    [0.74, 132],
    [1.05, 118],
    [1.9, 78],
  ].map(([spray, distance], index) => {
    const [x, , z] = sweptPoint(side * spray, distance, 0)
    return { x, z, height: 40, colorful: (index + (side > 0 ? 1 : 0)) % 2 === 0 }
  }),
)
export const LIGHT_TOWER_TARGET = new Vector3(0, 0, -40)

export type LightTower = (typeof LIGHT_TOWERS)[number]

/** The blossom's frame at the top of `tower`, its face turned toward the field. */
export function blossomFrame(tower: LightTower) {
  const top = new Vector3(tower.x, tower.height, tower.z)
  const facing = LIGHT_TOWER_TARGET.clone().sub(top).normalize()
  const turn = new Quaternion().setFromUnitVectors(new Vector3(0, 1, 0), facing)
  return new Matrix4().compose(top, turn, new Vector3(1, 1, 1))
}

/** A tower's stem, its two leaves, and the green cup under the blossom. */
export function towerGreenParts(tower: LightTower): PlacedPart[] {
  const leaves = [
    [0.32, 0.6],
    [0.55, 3.6],
  ].map(([height, turn]) => {
    const outward = new Vector3(Math.sin(turn + tower.x), 0, Math.cos(turn + tower.x))
    const center = new Vector3(tower.x, tower.height * height + 1.2, tower.z).addScaledVector(outward, 2.2)
    const tilted = outward.clone().setY(0.55).normalize()
    const lean = new Euler().setFromQuaternion(new Quaternion().setFromUnitVectors(new Vector3(0, 0, 1), tilted))
    return {
      geometry: unitSphere,
      at: center.toArray() as Triple,
      turn: [lean.x, lean.y, lean.z] as Triple,
      size: [1.1, 0.18, 2.6] as Triple,
    }
  })
  const cup = {
    geometry: new ConeGeometry(1.6, 1.4, 14).rotateX(Math.PI),
    at: [0, -0.4, 0] as Triple,
    size: [1.2, 1.4, 1.2] as Triple,
  }
  return [
    {
      geometry: new CylinderGeometry(0.32, 0.55, 1, 10),
      at: [tower.x, tower.height / 2, tower.z],
      size: [1, tower.height, 1],
    },
    ...leaves,
    ...placeInFrame([cup], blossomFrame(tower)),
  ]
}

/** The blossom's eight petals, alternately white and colored; `colored` picks which to return. */
export function towerBlossomParts(tower: LightTower, colored: boolean): PlacedPart[] {
  const petals = Array.from({ length: 8 }, (_, index) => {
    const angle = (index / 8) * Math.PI * 2
    return {
      geometry: unitSphere,
      at: [Math.cos(angle) * 2.6, 0.6, Math.sin(angle) * 2.6] as Triple,
      turn: [0, -angle, 0.6] as Triple,
      size: [2.3, 0.32, 1.25] as Triple,
      colored: index % 2 === 1,
    }
  }).filter((petal) => petal.colored === colored)
  return placeInFrame(petals, blossomFrame(tower))
}

/** The lamp at the heart of the blossom, which lights up when the town's lamps do. */
export function towerLampParts(tower: LightTower): PlacedPart[] {
  return placeInFrame([{ geometry: new CylinderGeometry(1.7, 1.3, 0.7, 20), at: [0, 0.2, 0] }], blossomFrame(tower))
}

/** Points as one flat array of coordinates, for a points geometry. */
export function glowPositions(spots: readonly Vector3[]) {
  return new Float32Array(spots.flatMap((spot) => spot.toArray()))
}

/** Where each tower lamp's glow is painted: just in front of its face, toward the field. */
export function towerLampGlowSpots() {
  return LIGHT_TOWERS.map((tower) => new Vector3(0, 1.4, 0).applyMatrix4(blossomFrame(tower)))
}

/** Parts given in `frame`'s space, as parts in the world: their geometry carries the frame. */
export function placeInFrame(parts: readonly PlacedPart[], frame: Matrix4): PlacedPart[] {
  return parts.map((part) => ({
    geometry: part.geometry.clone().applyMatrix4(frame.clone().multiply(partMatrix(part))),
  }))
}

/** The topiaries stand just beyond the fair balls' widest spray, either side of the home-run lawn. */
export const TOPIARIES = {
  corgi: { spray: -0.72, scale: 1.45 },
  ball: { spray: 0.72, radius: 3.6 },
  beyondFence: 11,
}

export function topiarySpot(spray: number) {
  const [x, , z] = sweptPoint(spray, fenceDistance(spray) + TOPIARIES.beyondFence, 0)
  return { x, z }
}

/**
 * A loafing corgi grown in orange and cream flowers on a hedge plinth, facing +z and about 6 m tall at scale 1: its
 * parts by what they are planted in.
 */
export function corgiParts() {
  const ears = [-1, 1].map((side) => ({
    geometry: new ConeGeometry(0.62, 1.5, 14),
    at: [side * 0.82, 5.85, 2.0] as Triple,
    turn: [-0.12, 0, side * -0.38] as Triple,
  }))
  const innerEars = [-1, 1].map((side) => ({
    geometry: new ConeGeometry(0.34, 0.9, 10),
    at: [side * 0.8, 5.75, 2.18] as Triple,
    turn: [-0.12, 0, side * -0.38] as Triple,
  }))
  const paws = [-1, 1].map((side) => sphere([side * 0.68, 1.88, 2.25], [0.5, 0.45, 0.85]))
  const legs = [-1, 1].map((side) => sphere([side * 1.05, 1.95, -2.0], [0.6, 0.5, 0.75]))
  const eyes = [-1, 1].map((side) => sphere([side * 0.5, 4.7, 3.25], [0.16, 0.2, 0.1]))
  return {
    orange: [
      sphere([0, 2.95, -0.3], [1.75, 1.35, 2.8]),
      sphere([0, 4.45, 2.2], [1.4, 1.3, 1.25]),
      sphere([0, 3.3, -3.0], [0.6, 0.55, 0.55]),
      ...legs,
      ...ears,
    ],
    cream: [sphere([0, 4.1, 3.25], [0.85, 0.62, 0.75]), sphere([0, 3.4, 1.95], [1, 1.05, 0.75]), ...paws, ...innerEars],
    ink: [sphere([0, 4.35, 3.98], [0.26, 0.2, 0.18]), ...eyes],
    hedge: [
      { geometry: new CylinderGeometry(1, 1, 1, 28), at: [0, 0.7, 0.2] as Triple, size: [3.2, 1.4, 4.6] as Triple },
    ],
    collar: [
      {
        geometry: new TorusGeometry(1.05, 0.2, 8, 28),
        at: [0, 3.75, 1.95] as Triple,
        turn: [Math.PI / 2 - 0.35, 0, 0] as Triple,
      },
    ],
    tag: [sphere([0, 3.0, 3.05], [0.26, 0.26, 0.12])],
  }
}

export function sphere(at: Triple, size: Triple): PlacedPart {
  return { geometry: leafySphere, at, size }
}

export function scaleUvs(geometry: BufferGeometry, across: number, up: number) {
  const uvs = geometry.getAttribute('uv')
  Array.from({ length: uvs.count }, (_, index) => index).forEach((index) =>
    uvs.setXY(index, uvs.getX(index) * across, uvs.getY(index) * up),
  )
  return geometry
}

/** A giant baseball trimmed from hedge, its seam in flowers, on a round stone planter. */
export function topiaryBallParts(radius: number) {
  const seamPoints = Array.from({ length: 96 }, (_, index) => {
    const angle = (index / 96) * Math.PI * 2
    return new Vector3(
      0.7 * Math.cos(angle) + 0.3 * Math.cos(3 * angle),
      0.7 * Math.sin(angle) - 0.3 * Math.sin(3 * angle),
      2 * Math.sqrt(0.21) * Math.sin(2 * angle),
    ).multiplyScalar(radius * 1.01)
  })
  const seam = new TubeGeometry(new CatmullRomCurve3(seamPoints, true), 160, radius * 0.06, 6, true)
  return {
    hedge: [{ geometry: scaleUvs(new SphereGeometry(radius, 32, 24), 4, 2), at: [0, radius + 1, 0] as Triple }],
    seam: [{ geometry: seam, at: [0, radius + 1, 0] as Triple, turn: [0.5, 0.3, 0.2] as Triple }],
    stone: [{ geometry: new CylinderGeometry(radius * 0.75, radius * 0.85, 1.2, 28), at: [0, 0.6, 0] as Triple }],
  }
}

/** The ground each landmark stands on, for the trees to keep clear of and the camera to stay out of. */
export function landmarkFootprints(): Clearing[] {
  const topiaries = [TOPIARIES.corgi.spray, TOPIARIES.ball.spray].map((spray) => ({ ...topiarySpot(spray), radius: 6 }))
  return [
    { x: OAK.x, z: OAK.z, radius: 14 },
    ...LIGHT_TOWERS.map((tower) => ({ x: tower.x, z: tower.z, radius: 4 })),
    ...topiaries,
  ]
}

/** Stacked topiary balls round the foot of each foul pole, biggest at the bottom. */
export const POLE_TOPIARY_RADII = [1.7, 1.45, 1.2, 0.95, 0.7, 0.5]

export const FENCE_SIGN = { width: 1.8, height: 1.35, label: [1.6, 1.05] as const, up: 1.7 }
/** A foul pole's sign hangs half a meter clear of the pole's lowest topiary ball, as seen from home plate too. */
export const POLE_SIGN_SPRAY =
  FOUL_ANGLE - (POLE_TOPIARY_RADII[0] + FENCE_SIGN.width / 2 + 0.5) / fenceDistance(FOUL_ANGLE)
/**
 * The distance signs on the hedge's face: by both foul poles, and either side of and at dead center. Each reads the
 * judge's fence distance where it hangs (game/field.ts), rounded to the meter.
 */
export const FENCE_SIGN_SPRAYS = [-POLE_SIGN_SPRAY, -0.42, 0, 0.42, POLE_SIGN_SPRAY]
/** Pixels per label row in the labels' texture, 256 across, so a label keeps its plane's shape. */
export const FENCE_LABEL_ROW = Math.round((256 * FENCE_SIGN.label[1]) / FENCE_SIGN.label[0])

export function fenceSignLabel(spray: number) {
  return `${Math.round(fenceDistance(spray))}m`
}

/**
 * Where a sign's board hangs, `inset` m in front of the hedge face and square to it: the hedge comes in toward the
 * poles, so off center its face turns from home, by over 20° at the poles.
 */
export function fenceSignPart(spray: number, inset: number): Omit<PlacedPart, 'geometry'> {
  const [x, y, z] = sweptPoint(spray, fenceDistance(spray) - inset, FENCE_SIGN.up)
  const slope = (fenceDistance(spray + 0.001) - fenceDistance(spray - 0.001)) / 0.002
  return { at: [x, y, z], turn: [0, Math.atan2(slope, fenceDistance(spray)) - spray, 0] }
}

/** All the labels as one geometry: each a plane showing its own row of a `labels.length`-row texture. */
export function createFenceLabelGeometry() {
  const [width, height] = FENCE_SIGN.label
  const rows = FENCE_SIGN_SPRAYS.length
  const planes = FENCE_SIGN_SPRAYS.map((spray, row) => {
    const plane = new PlaneGeometry(width, height)
    const uvs = plane.getAttribute('uv')
    Array.from({ length: uvs.count }, (_, index) => index).forEach((index) =>
      uvs.setY(index, (rows - 1 - row + uvs.getY(index)) / rows),
    )
    return plane.applyMatrix4(partMatrix(fenceSignPart(spray, 0.2)))
  })
  return mergeGeometries(planes) ?? new BufferGeometry()
}

/** Draws each sign's label in its own row of the labels' canvas: navy figures on cream. */
export function drawFenceLabels(context: CanvasRenderingContext2D) {
  const rowHeight = context.canvas.height / FENCE_SIGN_SPRAYS.length
  const { width } = context.canvas
  FENCE_SIGN_SPRAYS.forEach((spray, row) => {
    const top = row * rowHeight
    context.fillStyle = '#f8f3e7'
    context.fillRect(0, top, width, rowHeight)
    context.fillStyle = '#374b65'
    context.font = `900 ${rowHeight * 0.62}px 'Pretendard Variable', Pretendard, -apple-system, system-ui, sans-serif`
    context.textAlign = 'center'
    context.textBaseline = 'middle'
    context.fillText(fenceSignLabel(spray), width / 2, top + rowHeight * 0.54)
  })
}

export function poleTopiaryParts(pole: { x: number; z: number }): PlacedPart[] {
  const heights = POLE_TOPIARY_RADII.map((_, index) =>
    POLE_TOPIARY_RADII.slice(0, index).reduce((total, radius) => total + radius * 1.55, 0),
  )
  return POLE_TOPIARY_RADII.map((radius, index) => ({
    geometry: leafySphere,
    at: [pole.x, heights[index] + radius * 0.85, pole.z] as Triple,
    size: [radius, radius * 0.9, radius] as Triple,
  }))
}

/**
 * A garden shed open to the field (+z), in the ballpark's colors: its parts by the building role that colors them. Its
 * low walls and shallow roof (`pitch`, radians) stay under the sight lines of the chase camera low behind home plate
 * (cameraShots.ts chaseShot), so a foul coming down beyond a dugout stays in view until it is nearly down.
 */
export function shedParts() {
  const length = 9
  const depth = 3.6
  const wall = 2.3
  const pitch = 0.25
  const rise = (depth / 2) * Math.tan(pitch)
  const gable = new ShapeGeometry(
    new Shape()
      .moveTo(-depth / 2, 0)
      .lineTo(depth / 2, 0)
      .lineTo(0, rise + 0.07)
      .lineTo(-depth / 2, 0),
  )
  const sideWindows = [-1, 1].map((side) => ({ x: side * (length / 2 + 0.12), side }))
  return {
    walls: [
      box([0, wall / 2, -depth / 2], [length, wall, 0.22]),
      box([-length / 2, wall / 2, 0], [0.22, wall, depth]),
      box([length / 2, wall / 2, 0], [0.22, wall, depth]),
      box([0, 0.31, depth / 2 - 0.1], [length, 0.62, 0.18]),
      ...[-1, 1].map((side) => ({
        geometry: gable,
        at: [(side * length) / 2, wall, 0] as Triple,
        turn: [0, (side * Math.PI) / 2, 0] as Triple,
      })),
    ],
    roof: [-1, 1].map((side) => ({
      geometry: getRoundedBox(length + 1.2, 0.25, depth / 2 / Math.cos(pitch) + 0.7, 0.1),
      at: [0, wall + rise / 2 + 0.13, (side * depth) / 4.1] as Triple,
      turn: [side * pitch, 0, 0] as Triple,
    })),
    trim: [
      { geometry: getRoundedBox(length - 0.4, 0.34, 0.5, 0.1), at: [0, 0.76, depth / 2 - 0.1] as Triple },
      ...sideWindows.map(({ x }) => ({
        geometry: windowFrame,
        at: [x, wall - 1.1, 0] as Triple,
        turn: [0, Math.PI / 2, 0] as Triple,
      })),
      ...[-2.8, 0, 2.8].map((x) => ({ geometry: windowFrame, at: [x, wall - 0.95, -depth / 2 - 0.12] as Triple })),
    ],
    accent: [
      box([0, 0.12, 0], [length, 0.25, depth]),
      box([0, 0.5, -depth / 2 + 0.5], [length - 1, 0.45, 0.7]),
      {
        geometry: unitBox,
        at: [0, wall + 0.1, depth / 2 + 0.5] as Triple,
        turn: [-0.15, 0, 0] as Triple,
        size: [3.4, 0.85, 0.08] as Triple,
      },
    ],
    glass: [
      ...sideWindows.map(({ x, side }) => ({
        geometry: windowPane,
        at: [x + side * 0.005, wall - 1.1, 0] as Triple,
        turn: [0, (side * Math.PI) / 2, 0] as Triple,
      })),
      ...[-2.8, 0, 2.8].map((x) => ({
        geometry: windowPane,
        at: [x, wall - 0.95, -depth / 2 - 0.125] as Triple,
        turn: [0, Math.PI, 0] as Triple,
      })),
    ],
  }
}

export function box(at: Triple, size: Triple): PlacedPart {
  return { geometry: unitBox, at, size }
}

/** Both dugouts' sheds, one geometry per building role. */
export function createShedGeometries() {
  const parts = shedParts()
  const frames = DUGOUT_SPOTS.map((spot) => partMatrix({ at: [spot.x, 0, spot.z], turn: [0, spot.yaw, 0] }))
  const roles = Object.keys(parts) as (keyof typeof parts)[]
  return Object.fromEntries(
    roles.map((role) => [
      role,
      mergeGeometries(frames.map((frame) => mergeParts(parts[role], frame))) ?? new BufferGeometry(),
    ]),
  ) as Record<keyof typeof parts, BufferGeometry>
}

/** The front eave of each dugout, in the world, for a string of lights. */
export function shedEaves() {
  return DUGOUT_SPOTS.map((spot) => {
    const frame = partMatrix({ at: [spot.x, 0, spot.z], turn: [0, spot.yaw, 0] })
    return [-4.8, 4.8].map((x) => new Vector3(x, 2.2, 2.25).applyMatrix4(frame))
  })
}

/** Potted topiary balls along the top of the stands' back wall (none on the conservatory), and the lights strung between. */
export function standRailSpots() {
  const top = STANDS_TOP + STANDS.back
  return standCurve()
    .filter((_, index) => index % 8 === 0)
    .filter((sample) => Math.abs(sprayOf(sample.x, sample.z)) < (3 * Math.PI) / 4 - 0.05)
    .map((sample) => {
      const [x, , z] = standPoint(sample, STANDS_DEPTH + STANDS.wall / 2, 0)
      return { x, z, top }
    })
}

/**
 * Lights sagging between consecutive anchors, 1.1 m mid-span, with a bulb about every 1.1 m: the wire's segments (pairs
 * of points) and the bulbs along it.
 */
export function festoons(strands: readonly (readonly Vector3[])[]) {
  const sag = 1.1
  const spacing = 1.1
  const spans = strands.flatMap((anchors) => anchors.slice(1).map((to, index) => [anchors[index], to] as const))
  const points = spans.map(([from, to]) => {
    const count = Math.max(2, Math.round(from.distanceTo(to) / spacing))
    return Array.from({ length: count + 1 }, (_, step) =>
      from
        .clone()
        .lerp(to, step / count)
        .setY(from.y + (to.y - from.y) * (step / count) - Math.sin((step / count) * Math.PI) * sag),
    )
  })
  const wire = points.flatMap((span) =>
    span.slice(1).flatMap((point, step) => [...span[step].toArray(), ...point.toArray()]),
  )
  const bulbs = points.flatMap((span) => span.slice(1, -1).map((point) => point.clone().setY(point.y - 0.16)))
  return { wire, bulbs }
}

/** The string lights: along the top of each side of the stands, between the potted topiaries, and on the dugouts. */
export function landmarkLights() {
  const rails = standRailSpots()
  const anchors = [rails.filter((spot) => spot.x > 0), rails.filter((spot) => spot.x < 0)].map((side) =>
    side.map((spot) => new Vector3(spot.x, spot.top + 3.1, spot.z)),
  )
  return festoons([...anchors, ...shedEaves()])
}

/** Every landmark merged into one geometry per material it is drawn in. */
export function createLandmarkGeometries() {
  const oak = landmarkFrame(OAK.x, OAK.z, OAK.scale)
  const corgiSpot = topiarySpot(TOPIARIES.corgi.spray)
  const corgiFrame = landmarkFrame(corgiSpot.x, corgiSpot.z, TOPIARIES.corgi.scale)
  const ballSpot = topiarySpot(TOPIARIES.ball.spray)
  const ballFrame = landmarkFrame(ballSpot.x, ballSpot.z)
  const corgi = corgiParts()
  const ball = topiaryBallParts(TOPIARIES.ball.radius)
  const rails = standRailSpots()
  const towersOf = (colorful: boolean) => LIGHT_TOWERS.filter((tower) => tower.colorful === colorful)
  const signs = FENCE_SIGN_SPRAYS.map((spray) => ({
    geometry: getRoundedBox(FENCE_SIGN.width, FENCE_SIGN.height, 0.16, 0.06),
    ...fenceSignPart(spray, 0.1),
  }))
  const wire = new BufferGeometry()
  wire.setAttribute('position', new Float32BufferAttribute(landmarkLights().wire, 3))
  return {
    bark: mergeParts(oakBarkParts(), oak),
    crown: mergeParts(oakCrownParts(), oak),
    accent: mergeParts([
      ...placeInFrame(treehouseAccentParts(), oak),
      ...placeInFrame(corgi.tag, corgiFrame),
      ...towersOf(false).flatMap((tower) => towerBlossomParts(tower, true)),
    ]),
    roof: mergeParts([
      ...placeInFrame(treehouseRoofParts(), oak),
      ...placeInFrame(corgi.collar, corgiFrame),
      ...placeInFrame(ball.seam, ballFrame),
      ...towersOf(true).flatMap((tower) => towerBlossomParts(tower, true)),
      ...signs,
      ...rails.map((spot) => ({
        geometry: new CylinderGeometry(0.75, 0.55, 0.8, 12),
        at: [spot.x, spot.top + 0.4, spot.z] as const,
      })),
    ]),
    walls: mergeParts(treehouseWallParts(), oak),
    trim: mergeParts([
      ...placeInFrame(treehouseTrimParts(), oak),
      ...LIGHT_TOWERS.flatMap((tower) => towerBlossomParts(tower, false)),
    ]),
    glass: mergeParts(treehouseGlassParts(), oak),
    lamps: mergeParts([...LIGHT_TOWERS.flatMap(towerLampParts), ...placeInFrame(treehouseLanternParts(), oak)]),
    screen: mergeParts([{ geometry: new PlaneGeometry(SCOREBOARD.width, SCOREBOARD.height), at: SCOREBOARD.at }], oak),
    hedge: mergeParts([
      ...placeInFrame(corgi.hedge, corgiFrame),
      ...placeInFrame(ball.hedge, ballFrame),
      ...foulPoleSpots().flatMap(poleTopiaryParts),
      ...rails.map((spot) => ({ geometry: leafySphere, at: [spot.x, spot.top + 1.75, spot.z] as const, size: 1.05 })),
    ]),
    greens: mergeParts(LIGHT_TOWERS.flatMap(towerGreenParts)),
    orange: mergeParts(corgi.orange, corgiFrame),
    cream: mergeParts(corgi.cream, corgiFrame),
    ink: mergeParts(corgi.ink, corgiFrame),
    stone: mergeParts(ball.stone, ballFrame),
    labels: createFenceLabelGeometry(),
    wire,
  }
}
