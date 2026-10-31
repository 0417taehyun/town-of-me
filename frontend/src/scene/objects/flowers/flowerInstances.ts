import { Color, type InstancedMesh, type Object3D } from 'three'
import { seededFraction } from '../../../motionMath'
import type { ColorFade } from '../../environment/seasonTransition'
import { fadeInstanceColors, markInstancesUpdated } from '../../instancedMeshes'
import { getFlowerBloom, getFlowerPose, type FlowerLayout } from './flowerLayout'

export type PetalLayout = { flowerIndex: number; angle: number; ring: number }
export type FlowerMeshes = [InstancedMesh | null, InstancedMesh | null, InstancedMesh | null, InstancedMesh | null]

const BUD_GREEN = new Color('#5f9447')

/** Petals evenly around each flower; a rose's every other petal sits in an inner ring. */
export function getPetalLayouts(layouts: FlowerLayout[]) {
  return layouts.flatMap((layout, flowerIndex) =>
    Array.from({ length: layout.petalCount }, (_, petal): PetalLayout => ({
      flowerIndex,
      angle: (petal / layout.petalCount) * Math.PI * 2,
      ring: layout.kind === 'rose' && petal % 2 ? 0.58 : 1,
    })),
  )
}

export function setFlowerMatrices(
  poses: FlowerLayout[],
  petalLayouts: PetalLayout[],
  dummy: Object3D,
  meshes: FlowerMeshes,
) {
  const [stems, leaves, centers, petals] = meshes
  poses.forEach((layout, index) => {
    dummy.position.set(layout.x, layout.height / 2, layout.z)
    dummy.rotation.set(0, 0, 0)
    dummy.scale.set(0.055, layout.height / 2, 0.055)
    dummy.updateMatrix()
    stems?.setMatrixAt(index, dummy.matrix)

    dummy.position.set(layout.x + (index % 2 ? -0.12 : 0.12), layout.height * 0.45, layout.z)
    dummy.rotation.set(0, 0, index % 2 ? 0.75 : -0.75)
    dummy.scale.set(0.2, 0.06, 0.1)
    dummy.updateMatrix()
    leaves?.setMatrixAt(index, dummy.matrix)

    dummy.position.set(layout.x, layout.height, layout.z)
    dummy.rotation.set(0, 0, 0)
    dummy.scale.setScalar(layout.centerSize)
    dummy.updateMatrix()
    centers?.setMatrixAt(index, dummy.matrix)
  })
  petalLayouts.forEach(({ flowerIndex, angle, ring }, index) => {
    const layout = poses[flowerIndex]
    const distance = layout.petalDistance * ring
    dummy.position.set(
      layout.x + Math.cos(angle) * distance,
      layout.height - 0.015,
      layout.z + Math.sin(angle) * distance,
    )
    dummy.rotation.set(0, -angle, layout.petalTilt)
    dummy.scale.set(layout.petalLength, layout.petalThickness, layout.petalWidth)
    dummy.updateMatrix()
    petals?.setMatrixAt(index, dummy.matrix)
  })
}

/** A closed bud keeps a hint of its petal color at the tip. */
export function budColorOf(petalColor: string) {
  return `#${new Color(petalColor).lerp(BUD_GREEN, 0.7).getHexString()}`
}

/** Snow folds each flower into a bud at its own moment, and the thaw opens it again. */
export function setFlowerBloom(
  layouts: FlowerLayout[],
  petalLayouts: PetalLayout[],
  petalColors: ColorFade,
  dummy: Object3D,
  meshes: FlowerMeshes,
  snowCover: number,
) {
  const blooms = layouts.map((_, index) => getFlowerBloom(snowCover, seededFraction(index, 36)))
  const poses = layouts.map((layout, index) => getFlowerPose(layout, blooms[index]))
  setFlowerMatrices(poses, petalLayouts, dummy, meshes)
  fadeInstanceColors(meshes[3], petalColors, (index) => 1 - blooms[petalLayouts[index].flowerIndex])
  meshes.forEach(markInstancesUpdated)
}
