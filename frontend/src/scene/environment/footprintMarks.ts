import type { InstancedMesh, Object3D } from 'three'
import { getSnowFootprintVisibility, type getSnowFootprintPlacement } from '../motion/playerMotion'

export const SNOW_FOOTPRINT_CAPACITY = 192

export type FootprintPlacement = NonNullable<ReturnType<typeof getSnowFootprintPlacement>>
export type SnowFootprint = FootprintPlacement & { createdAt: number }

/** A footprint pressed into the snow, shrunk by `visibility`; a vanished one hides below the ground. */
export function setFootprintMatrix(
  mesh: InstancedMesh,
  dummy: Object3D,
  index: number,
  footprint: FootprintPlacement,
  visibility: number,
) {
  dummy.position.set(footprint.x, visibility ? 0.045 : -10, footprint.z)
  dummy.rotation.set(0, footprint.rotation, 0)
  dummy.scale.set(0.12 * visibility, 0.018 * visibility, 0.25 * visibility)
  dummy.updateMatrix()
  mesh.setMatrixAt(index, dummy.matrix)
}

/** Fades one footprint as it ages and frees its slot once it is gone; returns whether its instance changed. */
export function fadeFootprint(
  footprints: Array<SnowFootprint | null>,
  index: number,
  now: number,
  dummy: Object3D,
  mesh: InstancedMesh,
) {
  const footprint = footprints[index]
  if (!footprint) return false
  const visibility = getSnowFootprintVisibility(now - footprint.createdAt)
  if (visibility === 1) return false
  if (visibility === 0) footprints[index] = null
  setFootprintMatrix(mesh, dummy, index, footprint, visibility)
  return true
}

export function fadeFootprints(
  footprints: Array<SnowFootprint | null>,
  now: number,
  dummy: Object3D,
  mesh: InstancedMesh,
) {
  let changed = false
  for (let index = 0; index < footprints.length; index += 1) {
    changed = fadeFootprint(footprints, index, now, dummy, mesh) || changed
  }
  if (changed) mesh.instanceMatrix.needsUpdate = true
}
