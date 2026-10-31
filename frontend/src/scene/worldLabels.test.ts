import { describe, expect, it } from 'vitest'
import { Object3D, PerspectiveCamera } from 'three'
import { placeCurvedLabel } from './worldLabels'

const size = { width: 1000, height: 600 }

function labelAt(z: number) {
  const label = new Object3D()
  label.position.set(0, 2, z)
  label.updateMatrixWorld()
  return label
}

function cameraAt(height: number) {
  const camera = new PerspectiveCamera(50, size.width / size.height, 0.1, 300)
  camera.position.set(0, height, 0)
  camera.lookAt(0, 0, -20)
  camera.updateMatrixWorld()
  return camera
}

/** How far below drei's flat placement the label lands on screen, in pixels. */
function loweredBy(label: Object3D, camera: PerspectiveCamera) {
  const flat = label.position.clone().project(camera)
  return placeCurvedLabel(label, camera, size)[1] - ((1 - flat.y) * size.height) / 2
}

describe('world labels', () => {
  it('sink with the curved world, farther ones more, but not in the flat top view', () => {
    const town = cameraAt(6)
    expect(loweredBy(labelAt(-5), town)).toBeGreaterThan(0)
    expect(loweredBy(labelAt(-30), town)).toBeGreaterThan(loweredBy(labelAt(-5), town) * 4)
    expect(loweredBy(labelAt(-30), cameraAt(20))).toBeCloseTo(0)
  })
})
