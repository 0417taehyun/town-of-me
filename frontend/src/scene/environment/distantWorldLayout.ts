import type { Object3D } from 'three'
import type { TownPoint } from '../../data/models'

export const DISTANT_TREE_COUNT = 96
export const DISTANT_HILL_COUNT = 16
export const DISTANT_HEDGE_COUNT = 120

/** Squares a ring of `distance` so the forest and hills follow the town's square edge. */
export function getSquareRingRadius(angle: number, distance: number) {
  return distance / Math.max(Math.abs(Math.cos(angle)), Math.abs(Math.sin(angle)))
}

/** Where the forest's `index`th tree stands, in three rings round the town's square edge. */
export function forestTreePosition(index: number): TownPoint {
  const angle = (index / DISTANT_TREE_COUNT) * Math.PI * 2
  const radius = getSquareRingRadius(angle, 74 + (index % 3) * 13)
  return [Math.cos(angle) * radius, Math.sin(angle) * radius]
}

export function setForestTree(dummy: Object3D, index: number) {
  const [x, z] = forestTreePosition(index)
  const scale = 0.8 + (index % 5) * 0.1
  dummy.position.set(x, 3.8 * scale, z)
  dummy.rotation.set(0, index * 0.7, 0)
  dummy.scale.set(2.5 * scale, 6 * scale, 2.5 * scale)
}

export function setForestTrunk(dummy: Object3D, index: number) {
  setForestTree(dummy, index)
  dummy.position.y = 0.9
  dummy.scale.set(0.3, 1.8, 0.3)
}

export function setDistantHill(dummy: Object3D, index: number) {
  const angle = (index / DISTANT_HILL_COUNT) * Math.PI * 2
  const radius = getSquareRingRadius(angle, 118)
  dummy.position.set(Math.cos(angle) * radius, -2, Math.sin(angle) * radius)
  dummy.rotation.set(0, angle, 0)
  dummy.scale.set(24 + (index % 3) * 5, 9 + (index % 4) * 2, 23)
}

/** Where the hedge's `index`th bush stands: thirty along each side of the town's edge, north, west, south, east. */
export function hedgeBushPosition(index: number): TownPoint {
  const side = Math.floor(index / 30)
  const along = -51.8 + (index % 30) * (103.6 / 29)
  const edge = side < 2 ? -53.1 : 53.1
  return side % 2 === 0 ? [along, edge] : [edge, along]
}

export function setHedgeBush(dummy: Object3D, index: number) {
  const [x, z] = hedgeBushPosition(index)
  const horizontal = Math.floor(index / 30) % 2 === 0
  dummy.position.set(x, 0.65, z)
  dummy.rotation.set(0, horizontal ? 0 : Math.PI / 2, 0)
  dummy.scale.set(2.1, 0.95 + (index % 3) * 0.08, 1.05)
}
