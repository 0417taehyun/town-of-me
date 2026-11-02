import {
  CatmullRomCurve3,
  CylinderGeometry,
  type Group,
  type InstancedMesh,
  LatheGeometry,
  type Material,
  type Mesh,
  type Object3D,
  Shape,
  ShapeGeometry,
  SphereGeometry,
  TorusGeometry,
  TubeGeometry,
  Vector2,
  Vector3,
} from 'three'
import { seededFraction } from '../../../motionMath'
import type { Season } from '../../environment/season'
import {
  isSeasonChangeSettled,
  seasonClock,
  startColorFade,
  toLinearColors,
  type ColorFade,
  type SeasonChange,
  getWindowProgress,
} from '../../environment/seasonTransition'
import { fadeInstanceColors, writeInstanceMatrices } from '../../instancedMeshes'
import { createPodiumStageGeometry, pedestalTop } from '../../statues/paintedStatue'
import { PEDESTAL, PEDESTAL_COLORS, RANK_FINISHES, STATUE_RANKS, type StatueRank } from '../../statues/statueFinishes'
import { canvasTexture, paintNamePlaque } from '../../statues/statueTextures'
import { mergeParts, partMatrix, type PlacedPart, placeInFrame, type Triple } from './ballparkParts'
import { arcPoint, type PodiumGarden } from './ballparkStatueLayout'

// The podium garden's shapes in its own frame (ballparkStatueLayout.ts), merged into one geometry per material, and
// its flower beds, which bloom in the season's colors and close into buds under the snow.

/** The bunting's pennants, in the board's colors. */
export const BUNTING_COLORS = ['#ca7765', '#ece3cc', '#6f987c', '#d8b879', '#638fab', '#79647c']
const PENNANTS = 13

/** The beds' blooms: pink and white in spring, sunflowers in summer, chrysanthemums in autumn, green buds in winter. */
export const BED_COLORS = {
  spring: ['#f6a9c0', '#fff0f4', '#f2dc92', '#eb93a9', '#ffd1df'],
  summer: ['#ffd43b', '#ff8c42', '#30bced', '#ef476f', '#ffc928'],
  autumn: ['#e9671c', '#b8323c', '#efad32', '#f7901a', '#d8b879'],
  winter: ['#6f9a5c', '#7ea76a', '#5f9447'],
} satisfies Record<Season, string[]>

/** Each bed plant carries this many blooms over its leaf mound. */
export const BLOOMS_PER_PLANT = 3

/** One plant in a bed: where it stands, its size, and a seed that turns it and picks its colors. */
export type BedPlant = { x: number; z: number; size: number; seed: number }

export function bedPlants(garden: PodiumGarden): BedPlant[] {
  const { inner, outer, count, from, sweep } = garden.beds
  return Array.from({ length: count }, (_, index) => {
    const angle = from + sweep * ((index + seededFraction(index, 21) * 0.8) / count)
    const [x, z] = arcPoint(garden, angle, inner + (outer - inner) * seededFraction(index, 28))
    return { x, z, size: 0.7 + seededFraction(index, 24) * 0.6, seed: index }
  })
}

/** Every bloom's color in `season`, plant by plant. */
export function bedBloomColors(plants: readonly BedPlant[], season: Season) {
  const colors = BED_COLORS[season]
  return toLinearColors(
    Array.from(
      { length: plants.length * BLOOMS_PER_PLANT },
      (_, index) =>
        colors[(plants[Math.floor(index / BLOOMS_PER_PLANT)].seed + (index % BLOOMS_PER_PLANT)) % colors.length],
    ),
  )
}

export type BedMeshes = { leaves: InstancedMesh | null; blooms: InstancedMesh | null; snow: InstancedMesh | null }

/** Poses the beds under `cover` of snow: the blooms close and sink a little, and a drift settles on each mound. */
export function poseBeds(
  { leaves, blooms, snow }: BedMeshes,
  plants: readonly BedPlant[],
  cover: number,
  dummy: Object3D,
) {
  writeInstanceMatrices(leaves, dummy, plants.length, (mound, index) => {
    const { x, z, size, seed } = plants[index]
    mound.position.set(x, 0.12, z)
    mound.rotation.set(0, seed, 0)
    mound.scale.set(0.34 * size, 0.22 * size, 0.3 * size)
  })
  writeInstanceMatrices(snow, dummy, plants.length, (drift, index) => {
    const { x, z, size } = plants[index]
    drift.position.set(x, 0.2, z)
    drift.scale.set(0.36 * size, Math.max(0.001, 0.16 * size * cover), 0.32 * size)
  })
  writeInstanceMatrices(blooms, dummy, plants.length * BLOOMS_PER_PLANT, (bloom, index) => {
    const { x, z, size, seed } = plants[Math.floor(index / BLOOMS_PER_PLANT)]
    const order = index % BLOOMS_PER_PLANT
    const angle = seed * 1.7 + order * 2.1
    bloom.position.set(
      x + Math.cos(angle) * 0.14 * size,
      0.3 + order * 0.03 - 0.04 * cover,
      z + Math.sin(angle) * 0.14 * size,
    )
    bloom.rotation.set(0, 0, 0)
    bloom.scale.setScalar((0.1 - 0.05 * cover) * size)
  })
  if (snow) snow.visible = cover > 0.001
}

export type BedFade = { startedAt: number; colors: ColorFade; settled: boolean }

/** Fades the blooms to the new season's colors while the town's grass and hedges change. */
export function fadeBedColors(
  blooms: InstancedMesh | null,
  fade: { current: BedFade | null },
  plants: readonly BedPlant[],
  change: SeasonChange,
) {
  if (fade.current?.startedAt === change.startedAt && fade.current.settled) return
  if (fade.current?.startedAt !== change.startedAt) {
    const colors = startColorFade(blooms?.instanceColor?.array, bedBloomColors(plants, change.to))
    fade.current = { startedAt: change.startedAt, colors, settled: false }
  }
  const now = seasonClock()
  const progress = getWindowProgress(change.timeline.ground, now - change.startedAt)
  fadeInstanceColors(blooms, fade.current.colors, () => progress)
  fade.current.settled = isSeasonChangeSettled(change, now)
}

/** A point on the bunting's string, `progress` from its left post to its right, hanging `sag` low in the middle. */
export function buntingPoint(garden: PodiumGarden, progress: number) {
  const { halfWidth, z, height, sag } = garden.bunting
  return new Vector3(-halfWidth + halfWidth * 2 * progress, height - Math.sin(progress * Math.PI) * sag, z)
}

/** Where each pennant hangs from the string, between the posts. */
export function pennantPositions(garden: PodiumGarden) {
  return Array.from({ length: PENNANTS }, (_, index) => buntingPoint(garden, (index + 1) / (PENNANTS + 1)))
}

/** A pennant hanging from its top edge. */
export function pennantGeometry() {
  const pennant = new Shape().moveTo(-0.17, 0).lineTo(0.17, 0).lineTo(0, -0.34).closePath()
  return new ShapeGeometry(pennant)
}

/** The hedge's arc, its open ends rounded off with a ball each. */
export function hedgeParts(garden: PodiumGarden): PlacedPart[] {
  const { radius, tube, stretch, y, from, sweep } = garden.hedge
  const ends = [from, from + sweep].map((angle): PlacedPart => {
    const [x, z] = arcPoint(garden, angle, radius)
    return { geometry: new SphereGeometry(1, 12, 8), at: [x, y, z], size: [tube, tube * stretch, tube] }
  })
  return [
    {
      geometry: new TorusGeometry(radius, tube, 12, 48, sweep),
      at: [0, y, garden.arcCenterZ],
      turn: [Math.PI / 2, 0, from],
      size: [1, 1, stretch],
    },
    ...ends,
  ]
}

/** The wood: the bunting's posts and string, and the sign's two posts. */
export function woodParts(garden: PodiumGarden): PlacedPart[] {
  const { halfWidth, z, height } = garden.bunting
  const buntingPosts = [-1, 1].map((side): PlacedPart => ({
    geometry: new CylinderGeometry(0.06, 0.08, height + 0.2, 8),
    at: [side * halfWidth, (height + 0.2) / 2, z],
  }))
  const string = new CatmullRomCurve3(Array.from({ length: 17 }, (_, step) => buntingPoint(garden, step / 16)))
  const sign = garden.sign
  const signPosts = [-1, 1].map((side): PlacedPart => ({
    geometry: new CylinderGeometry(0.06, 0.07, sign.height + 0.2, 8),
    at: [side * 0.6, (sign.height + 0.2) / 2, -0.12],
  }))
  const signFrame = partMatrix({ at: [sign.x, 0, sign.z], turn: [0, sign.turn, 0] })
  return [...buntingPosts, { geometry: new TubeGeometry(string, 32, 0.012, 4) }, ...placeInFrame(signPosts, signFrame)]
}

/** The gold balls topping the bunting's posts. */
export function knobParts(garden: PodiumGarden): PlacedPart[] {
  const { halfWidth, z, height } = garden.bunting
  return [-1, 1].map((side) => ({ geometry: new SphereGeometry(0.1, 10, 8), at: [side * halfWidth, height + 0.25, z] }))
}

/** The stage, standing `height` over the grass with the pedestals on its top. */
export function stagePart(garden: PodiumGarden): PlacedPart {
  const { radiusX, radiusZ, z, height } = garden.stage
  return { geometry: createPodiumStageGeometry(height), at: [0, height, z], size: [radiusX, 1, radiusZ] }
}

/** The garden's still parts as one geometry per material. */
export function createGardenGeometries(garden: PodiumGarden) {
  return {
    stage: mergeParts([stagePart(garden)]),
    hedge: mergeParts(hedgeParts(garden)),
    wood: mergeParts(woodParts(garden)),
    knobs: mergeParts(knobParts(garden)),
    pennant: pennantGeometry(),
    bedPlant: new SphereGeometry(1, 10, 6),
  }
}

/** A lathe ring of snow lying on a flat ledge between two radii, `depth` deep at its crest. */
export function snowRing(inner: number, outer: number, y: number, depth: number) {
  const middle = (inner + outer) / 2
  const profile: [number, number][] = [
    [inner, y],
    [inner + 0.02, y + depth * 0.7],
    [middle, y + depth],
    [outer - 0.02, y + depth * 0.6],
    [outer, y],
  ]
  return new LatheGeometry(
    profile.map(([radius, height]) => new Vector2(radius, height)),
    48,
  )
}

/**
 * The snow on an empty pedestal in winter, in statue units: on the top round the waiting ball, with a cap on the ball,
 * and on the plinth's ledge. Each rests at its own height, where `RoofSnow` grows it from.
 */
export function pedestalSnow(rank: StatueRank) {
  const top = pedestalTop(rank)
  const cap: PlacedPart = {
    geometry: new SphereGeometry(0.17, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2),
    at: [0, top + 0.47, 0] as Triple,
    size: [1, 0.45, 1],
  }
  return {
    top,
    onTop: mergeParts([{ geometry: snowRing(0.36, 0.66, top, 0.05) }, cap]),
    onPlinth: snowRing(PEDESTAL.radius + 0.01, PEDESTAL.plinthRadius + 0.005, PEDESTAL.plinthHeight, 0.035),
  }
}

/** Each place's plaque saying `text`, in its own star's metal. */
export function createPlaques(text: string, webFontReady: boolean) {
  const plaque = (rank: StatueRank) =>
    canvasTexture(512, 116, paintNamePlaque(PEDESTAL_COLORS.plaque, RANK_FINISHES[rank].emblem, text, webFontReady))
  return { 1: plaque(1), 2: plaque(2), 3: plaque(3) }
}

export function disposePlaques(plaques: ReturnType<typeof createPlaques>) {
  STATUE_RANKS.forEach((rank) => plaques[rank].dispose())
}

/** Frees the merged statues' geometry and the materials they draw with; the shared textures stay. */
export function disposeMerged(merged: Group) {
  merged.children.forEach((child) => {
    const mesh = child as Mesh
    mesh.geometry.dispose()
    ;(mesh.material as Material).dispose()
  })
}
