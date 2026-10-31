import { CanvasTexture, type InstancedMesh, type Object3D, type Vector3 } from 'three'
import type { SunPosition } from '../../environment/dayCycle'
import { smoothstep } from '../../../motionMath'
import { writeInstanceColors, writeInstanceMatrices, writeInstanceOpacities } from '../../instancedMeshes'
import {
  getBirdPartColor,
  PARTS_PER_BIRD,
  PUFFS_PER_CLOUD,
  setBirdTransform,
  setCloudShadowTransform,
  setCloudTransform,
  type BirdSpec,
  type CloudSpec,
} from './skyMotion'

/** The instance indices of `parts` for every bird, in bird order. */
export function birdInstances(birdCount: number, parts: number[]) {
  return Array.from({ length: birdCount }, (_, bird) => parts.map((part) => bird * PARTS_PER_BIRD + part)).flat()
}

export function colorBirdParts(mesh: InstancedMesh | null, birds: BirdSpec[], instances: number[]) {
  writeInstanceColors(mesh, instances.length, (index) =>
    getBirdPartColor(birds[Math.floor(instances[index] / PARTS_PER_BIRD)].palette, instances[index] % PARTS_PER_BIRD),
  )
}

export function colorClouds(mesh: InstancedMesh | null, clouds: CloudSpec[]) {
  writeInstanceColors(
    mesh,
    clouds.length * PUFFS_PER_CLOUD,
    (index) => clouds[Math.floor(index / PUFFS_PER_CLOUD)].color,
  )
}

export function updateClouds(
  mesh: InstancedMesh | null,
  dummy: Object3D,
  clouds: CloudSpec[],
  elapsed: number,
  puffCount: number,
) {
  writeInstanceMatrices(mesh, dummy, puffCount, (transform, index) =>
    setCloudTransform(transform, clouds, index, elapsed),
  )
}

/** Poses the first `count` of `instances`, which index each bird's parts. */
export function updateBirds(
  mesh: InstancedMesh | null,
  dummy: Object3D,
  birds: BirdSpec[],
  instances: number[],
  count: number,
  elapsed: number,
  reducedMotion: boolean,
) {
  writeInstanceMatrices(mesh, dummy, count, (transform, index) =>
    setBirdTransform(transform, birds, instances[index], elapsed, reducedMotion),
  )
}

/** Draws the first `count` bird parts, each faded with its bird's presence. */
export function fadeBirds(mesh: InstancedMesh | null, instances: number[], presence: Float32Array, count: number) {
  if (!mesh) return
  mesh.count = count
  writeInstanceOpacities(mesh, count, (index) => smoothstep(presence[Math.floor(instances[index] / PARTS_PER_BIRD)]))
}

/** Draws the first `count` cloud puffs (or, with `partsPerCloud` 1, shadows), each faded with its cloud's presence. */
export function fadeClouds(mesh: InstancedMesh | null, presence: Float32Array, count: number, partsPerCloud: number) {
  if (!mesh) return
  mesh.count = count
  writeInstanceOpacities(mesh, count, (index) => smoothstep(presence[Math.floor(index / partsPerCloud)]))
}

export function updateCloudShadows(
  mesh: InstancedMesh | null,
  dummy: Object3D,
  clouds: CloudSpec[],
  elapsed: number,
  sunPosition: SunPosition,
  cloudCount: number,
) {
  writeInstanceMatrices(mesh, dummy, cloudCount, (transform, index) =>
    setCloudShadowTransform(transform, clouds, index, elapsed, sunPosition),
  )
}

/** The sun as the cloud shadows expect it: the same direction, 24 m out from the town horizontally. */
export function writeCloudShadowSun(sunDirection: Vector3, out: SunPosition) {
  const horizontalScale = 24 / Math.hypot(sunDirection.x, sunDirection.z)
  out[0] = sunDirection.x * horizontalScale
  out[1] = sunDirection.y * horizontalScale
  out[2] = sunDirection.z * horizontalScale
}

export function createShadowTexture() {
  const canvas = document.createElement('canvas')
  canvas.width = 128
  canvas.height = 128
  const context = canvas.getContext('2d')!
  ;[
    [36, 68],
    [65, 54],
    [91, 69],
  ].forEach(([x, y]) => {
    const gradient = context.createRadialGradient(x, y, 0, x, y, 35)
    gradient.addColorStop(0, 'rgba(0,0,0,0.65)')
    gradient.addColorStop(0.45, 'rgba(0,0,0,0.35)')
    gradient.addColorStop(1, 'rgba(0,0,0,0)')
    context.fillStyle = gradient
    context.fillRect(0, 0, 128, 128)
  })
  return new CanvasTexture(canvas)
}
