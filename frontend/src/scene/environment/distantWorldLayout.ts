import type { Object3D } from 'three'

export const DISTANT_TREE_COUNT = 96
export const DISTANT_HILL_COUNT = 16
export const DISTANT_HEDGE_COUNT = 120

/** Squares a ring of `distance` so the forest and hills follow the town's square edge. */
export function getSquareRingRadius(angle: number, distance: number) {
  return distance / Math.max(Math.abs(Math.cos(angle)), Math.abs(Math.sin(angle)))
}

export function setForestTree(dummy: Object3D, index: number) {
  const angle = (index / DISTANT_TREE_COUNT) * Math.PI * 2
  const radius = getSquareRingRadius(angle, 74 + (index % 3) * 13)
  const scale = 0.8 + (index % 5) * 0.1
  dummy.position.set(Math.cos(angle) * radius, 3.8 * scale, Math.sin(angle) * radius)
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

/** Thirty bushes along each side of the town's edge. */
export function setHedgeBush(dummy: Object3D, index: number) {
  const side = Math.floor(index / 30)
  const along = -51.8 + (index % 30) * (103.6 / 29)
  const horizontal = side % 2 === 0
  const edge = side < 2 ? -53.1 : 53.1
  dummy.position.set(horizontal ? along : edge, 0.65, horizontal ? edge : along)
  dummy.rotation.set(0, horizontal ? 0 : Math.PI / 2, 0)
  dummy.scale.set(2.1, 0.95 + (index % 3) * 0.08, 1.05)
}
