import { Color, type InstancedMesh, type Object3D } from 'three'
import type { TownObject } from '../../../data/models'
import { clamp01, seededFraction } from '../../../motionMath'
import { getSeasonTreeColor, type Season } from '../../environment/season'
import {
  getStaggeredWindow,
  getWindowFraction,
  toLinearColors,
  type ColorFade,
  type SeasonWindow,
} from '../../environment/seasonTransition'
import { objectVariant, resolveVariant } from '../../objectVariant'
import {
  getCrownSway,
  getSeasonalTreeSources,
  getTreeLayout,
  getTreeStagger,
  type SeasonalTreeSource,
} from './treeLayout'

export function treeColorOf(object: TownObject, season: Season, top: boolean) {
  if (!object.color) return getSeasonTreeColor(season, objectVariant(object.id), resolveVariant(object, 'tree'), top)
  return top ? `#${new Color(object.color).offsetHSL(0, 0, 0.08).getHexString()}` : object.color
}

export function treeColorsOf(objects: TownObject[], season: Season, top: boolean) {
  return toLinearColors(objects.map((object) => treeColorOf(object, season, top)))
}

export function setTrunkPose(dummy: Object3D, object: TownObject) {
  const { scale, position } = getTreeLayout(object)
  dummy.position.set(...position)
  dummy.rotation.set(0, object.rotation, 0)
  dummy.scale.set(scale, scale, scale)
}

/** Crowns sway while their tree shakes off its leaves; `shakeOf` is 0 for a still tree. */
export function setCrownMatrices(
  objects: TownObject[],
  dummy: Object3D,
  meshes: [InstancedMesh | null, InstancedMesh | null],
  shakeOf: (index: number) => number,
  elapsed: number,
) {
  const [crowns, crownTops] = meshes
  objects.forEach((object, index) => {
    const { scale } = getTreeLayout(object)
    const { x: swayX, z: swayZ } = getCrownSway(shakeOf(index), elapsed, index, scale)
    dummy.position.set(object.position.x + swayX, object.position.y + 3.05 * scale, object.position.z + swayZ)
    dummy.rotation.set(0, object.rotation + 0.22, 0)
    dummy.scale.setScalar(scale)
    dummy.updateMatrix()
    crowns?.setMatrixAt(index, dummy.matrix)
    dummy.position.set(
      object.position.x + swayX * 1.5,
      object.position.y + 4.25 * scale,
      object.position.z + swayZ * 1.5,
    )
    dummy.scale.multiplyScalar(0.72)
    dummy.updateMatrix()
    crownTops?.setMatrixAt(index, dummy.matrix)
  })
}

/** How hard tree `index` shakes while it sheds its leaves; 0 for a tree that keeps them. */
export function getCrownShake(leafDrop: SeasonWindow | null, shedding: Set<number>, index: number, elapsed: number) {
  if (!leafDrop || !shedding.has(index)) return 0
  return Math.sin(Math.PI * getWindowFraction(getStaggeredWindow(leafDrop, getTreeStagger(index)), elapsed))
}

/** Snow gathers on each tree a little after the last one and sinks into the crown as it melts. */
export function setSnowCapMatrices(
  snowyTrees: SeasonalTreeSource[],
  dummy: Object3D,
  mesh: InstancedMesh | null,
  cover: number,
) {
  snowyTrees.forEach((tree, index) => {
    const treeCover = clamp01((cover - getTreeStagger(tree.treeIndex) * 0.3) / 0.7)
    const spread = 0.55 + 0.45 * treeCover
    dummy.position.set(tree.x, tree.groundY + (4.7 - (1 - treeCover) * 0.15) * tree.scale, tree.z)
    dummy.rotation.set(0, tree.treeIndex * 0.29, 0)
    dummy.scale.set(1.08 * tree.scale * spread, 0.22 * tree.scale * treeCover, tree.scale * spread)
    dummy.updateMatrix()
    mesh?.setMatrixAt(index, dummy.matrix)
  })
}

export type TreeFades = { startedAt: number; crowns: ColorFade; tops: ColorFade; shedding: Set<number> }

const groundCoverColors = {
  spring: ['#ffd1df', '#f6a9c0', '#fff0f4'],
  summer: ['#ffffff'],
  autumn: ['#df7a25', '#bd4932', '#efad32'],
  winter: ['#f4fbff', '#dcebee', '#ffffff'],
} satisfies Record<Season, string[]>

export const GROUND_COVER_SEASONS = ['spring', 'autumn', 'winter'] as const

export type GroundCoverPiece = { tree: SeasonalTreeSource; index: number; season: Season }

export function getGroundCoverPieces(objects: TownObject[]) {
  return GROUND_COVER_SEASONS.flatMap((season) =>
    getSeasonalTreeSources(objects, season).flatMap((tree) =>
      Array.from({ length: season === 'winter' ? 4 : 10 }, (_, index): GroundCoverPiece => ({ tree, index, season })),
    ),
  )
}

export function getGroundCoverColor(pieces: GroundCoverPiece[], index: number) {
  const colors = groundCoverColors[pieces[index].season]
  return colors[index % colors.length]
}

/** Petal and leaf piles lie flat; winter's drifts are deeper mounds. Each piece grows in a little after the last. */
export function setGroundCoverPose(dummy: Object3D, { tree, index, season }: GroundCoverPiece, amount: number) {
  const angle = index * 2.39996 + tree.treeIndex * 0.73
  const radius = tree.scale * (0.68 + (index % 4) * 0.34)
  const grown = clamp01(amount * 1.6 - seededFraction(index + tree.treeIndex * 10, 33) * 0.6)
  const size = tree.scale * grown
  dummy.position.set(tree.x + Math.cos(angle) * radius, tree.groundY, tree.z + Math.sin(angle) * radius)
  dummy.rotation.set(0, angle, 0)
  dummy.scale.set(0.3 * size, 0.035 * size, 0.18 * size)
  if (season === 'winter') dummy.scale.set(0.72 * size, 0.07 * size, 0.48 * size)
}
