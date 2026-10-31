import {
  Color,
  DynamicDrawUsage,
  InstancedBufferAttribute,
  Object3D,
  type ColorRepresentation,
  type InstancedMesh,
  type WebGLProgramParametersWithUniforms,
} from 'three'
import { writeColorFade, type ColorFade } from './environment/seasonTransition'

/** An axis-aligned box part: its center, then its width, height, and depth. */
export type BoxPart = readonly [x: number, y: number, z: number, width: number, height: number, depth: number]

const scratchColor = new Color()

/** Poses `count` instances in turn on `dummy` and copies each pose into `mesh`, starting at `firstIndex`. */
export function writeInstanceMatrices(
  mesh: InstancedMesh | null,
  dummy: Object3D,
  count: number,
  pose: (dummy: Object3D, index: number) => void,
  firstIndex = 0,
) {
  if (!mesh) return
  for (let index = 0; index < count; index += 1) {
    pose(dummy, index)
    dummy.updateMatrix()
    mesh.setMatrixAt(firstIndex + index, dummy.matrix)
  }
  mesh.instanceMatrix.needsUpdate = true
}

export function writeInstanceColors(
  mesh: InstancedMesh | null,
  count: number,
  colorOf: (index: number) => ColorRepresentation,
) {
  if (!mesh) return
  for (let index = 0; index < count; index += 1) mesh.setColorAt(index, scratchColor.set(colorOf(index)))
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true
}

/** Lets a material fade each instance on its own, by the opacities `writeInstanceOpacities` fills in. */
export function addInstanceOpacity(shader: WebGLProgramParametersWithUniforms) {
  shader.vertexShader = shader.vertexShader
    .replace(
      '#include <common>',
      '#include <common>\nattribute float instanceOpacity;\nvarying float vInstanceOpacity;',
    )
    .replace('#include <begin_vertex>', '#include <begin_vertex>\nvInstanceOpacity = instanceOpacity;')
  shader.fragmentShader = shader.fragmentShader
    .replace('#include <common>', '#include <common>\nvarying float vInstanceOpacity;')
    .replace('#include <alphatest_fragment>', 'diffuseColor.a *= vInstanceOpacity;\n#include <alphatest_fragment>')
}

/** Gives every instance full opacity before the first draw; a missing attribute would read as 0 and hide them all. */
export function createInstanceOpacities(mesh: InstancedMesh | null) {
  if (!mesh || mesh.geometry.getAttribute('instanceOpacity')) return
  const opacities = new InstancedBufferAttribute(new Float32Array(mesh.instanceMatrix.count).fill(1), 1)
  opacities.setUsage(DynamicDrawUsage)
  mesh.geometry.setAttribute('instanceOpacity', opacities)
}

export function writeInstanceOpacities(
  mesh: InstancedMesh | null,
  count: number,
  opacityOf: (index: number) => number,
) {
  const opacities = mesh?.geometry.getAttribute('instanceOpacity')
  if (!opacities) return
  for (let index = 0; index < count; index += 1) opacities.array[index] = opacityOf(index)
  opacities.needsUpdate = true
}

export function markInstancesUpdated(mesh: InstancedMesh | null) {
  if (!mesh) return
  mesh.instanceMatrix.needsUpdate = true
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true
}

/** Writes a whole season's instance colors, creating the color buffer on first use. */
export function setInstanceColors(mesh: InstancedMesh | null, colors: Float32Array) {
  if (!mesh || colors.length === 0) return
  if (!mesh.instanceColor) mesh.setColorAt(0, new Color())
  mesh.instanceColor?.array.set(colors)
}

export function fadeInstanceColors(mesh: InstancedMesh | null, fade: ColorFade, progressOf: (index: number) => number) {
  const colors = mesh?.instanceColor
  if (!colors) return
  writeColorFade(fade, progressOf, colors.array as Float32Array)
  colors.needsUpdate = true
}

export function setBoxPart(dummy: Object3D, [x, y, z, width, height, depth]: BoxPart) {
  dummy.position.set(x, y, z)
  dummy.scale.set(width, height, depth)
}

export function writeBoxParts(mesh: InstancedMesh | null, parts: readonly BoxPart[]) {
  writeInstanceMatrices(mesh, new Object3D(), parts.length, (dummy, index) => setBoxPart(dummy, parts[index]))
  mesh?.computeBoundingSphere()
}
