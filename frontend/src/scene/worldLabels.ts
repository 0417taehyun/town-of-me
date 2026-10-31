import { PerspectiveCamera, Vector3, type Camera, type Object3D } from 'three'
import { getWorldCurveDrop } from './worldCurve'

/**
 * drei's Html labels default to a z-index in the millions, which puts name tags above speech bubbles and the whole
 * interface. Kept below the interface layer (z-index 5 in styles.css), world labels stay in the world.
 */
export const WORLD_LABEL_LAYERS: [number, number] = [4, 0]

const labelPoint = new Vector3()
const cameraPoint = new Vector3()

/** drei's Html placement lowered by the world curve, so a label stays over the bent object it names. */
export function placeCurvedLabel(label: Object3D, camera: Camera, size: { width: number; height: number }) {
  labelPoint.setFromMatrixPosition(label.matrixWorld)
  cameraPoint.setFromMatrixPosition(camera.matrixWorld)
  const horizontalDistanceSquared = (labelPoint.x - cameraPoint.x) ** 2 + (labelPoint.z - cameraPoint.z) ** 2
  const curved = camera instanceof PerspectiveCamera
  labelPoint.y -= curved ? getWorldCurveDrop(horizontalDistanceSquared, cameraPoint.y) : 0
  labelPoint.project(camera)
  return [((labelPoint.x + 1) * size.width) / 2, ((1 - labelPoint.y) * size.height) / 2]
}
