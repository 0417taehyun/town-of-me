import { Euler, Matrix4, Quaternion, Vector3 } from 'three'
import type { AvatarPart } from '../../../scene/characters/avatarAppearance'
import { BALLPLAYER_BODY, type BallplayerRig } from './ballplayerRig'

// The ballplayer's head (with its hair, hat, ears, and nose) and torso as simple solids in the rig frame, so the batter
// can keep its arms out of them and a test can keep the bat out of the head. Each part is the shape its mesh draws:
// spheres and cones as ellipsoids, cylinders (a sun hat), boxes, and the torso's rounded box.

export type BodyVolume = {
  part: 'head' | 'torso'
  shape: 'ellipsoid' | 'box' | 'cylinder' | 'roundedBox'
  center: Vector3
  /** Turns a rig-frame offset from the center into the solid's own axes. */
  inverse: Quaternion
  /** Half extents along the solid's own axes. */
  radii: Vector3
  rounding: number
}

/** Head parts big enough to hit: eyes, mouths, and mustaches lie flat on the face and are left out. */
export const SOLID_HEAD_PART = /^(head|nose|ear|curl|hair|fringe|cap|beanie|pom|hat)/
const SMALLEST_SOLID = 0.055

const partTurn = new Quaternion()
const partAngles = new Euler()
const headMatrix = new Matrix4()
const headTurn = new Quaternion()

/** Whether head part `part` is a solid the bat or an arm can hit. */
export function isSolidHeadPart(part: AvatarPart) {
  return SOLID_HEAD_PART.test(part.id) && part.shape !== 'arc' && Math.max(...part.scale) >= SMALLEST_SOLID
}

/** Head part `part` as a solid, for a head posed by `matrix` and turned by `turn` (rig frame). */
export function headPartVolume(part: AvatarPart, matrix: Matrix4, turn: Quaternion): BodyVolume {
  const [scaleX, scaleY, scaleZ] = part.scale
  partTurn.setFromEuler(partAngles.set(...(part.rotation ?? [0, 0, 0])))
  const halfHeight = part.shape === 'cone' || part.shape === 'cylinder' ? scaleY / 2 : scaleY
  const radii =
    part.shape === 'box' ? new Vector3(scaleX / 2, scaleY / 2, scaleZ / 2) : new Vector3(scaleX, halfHeight, scaleZ)
  return {
    part: 'head',
    shape: part.shape === 'box' || part.shape === 'cylinder' ? part.shape : 'ellipsoid',
    center: new Vector3(...part.position).applyMatrix4(matrix),
    inverse: turn.clone().multiply(partTurn).invert(),
    radii,
    rounding: 0,
  }
}

/** The head's solids and the torso as last posed (poseChest), in the rig frame. */
export function bodyVolumes(rig: BallplayerRig): BodyVolume[] {
  const { body, head } = rig
  headMatrix.multiplyMatrices(body.matrix, head.matrix)
  headTurn.copy(body.quaternion).multiply(head.quaternion)
  const { torso } = BALLPLAYER_BODY
  const torsoVolume: BodyVolume = {
    part: 'torso',
    shape: 'roundedBox',
    center: new Vector3(0, torso.centerY, 0).applyMatrix4(body.matrix),
    inverse: body.quaternion.clone().invert(),
    radii: new Vector3(torso.width / 2, torso.height / 2, torso.depth / 2),
    rounding: torso.rounding,
  }
  const headVolumes = rig.appearance.headParts
    .filter(isSolidHeadPart)
    .map((part) => headPartVolume(part, headMatrix, headTurn))
  return [...headVolumes, torsoVolume]
}

const local = new Vector3()

/** How deep a sphere (`center`, `radius`) sits inside `volume`, in rig units (0 when clear). */
export function penetration(volume: BodyVolume, center: Vector3, radius: number) {
  local.copy(center).sub(volume.center).applyQuaternion(volume.inverse)
  if (volume.shape === 'roundedBox') return roundedBoxPenetration(volume, local, radius)
  if (volume.shape === 'box') return boxPenetration(volume.radii, local, radius)
  if (volume.shape === 'cylinder') return cylinderPenetration(volume.radii, local, radius)
  const { radii } = volume
  const inflated = Math.hypot(local.x / (radii.x + radius), local.y / (radii.y + radius), local.z / (radii.z + radius))
  return inflated < 1 ? (1 - inflated) * (Math.min(radii.x, radii.y, radii.z) + radius) : 0
}

/** How deep a sphere of `radius` centered at `local` (in the solid's own axes) sits in a rounded box. */
export function roundedBoxPenetration({ radii, rounding }: BodyVolume, local: Vector3, radius: number) {
  const outX = Math.abs(local.x) - (radii.x - rounding)
  const outY = Math.abs(local.y) - (radii.y - rounding)
  const outZ = Math.abs(local.z) - (radii.z - rounding)
  const outside = Math.hypot(Math.max(outX, 0), Math.max(outY, 0), Math.max(outZ, 0))
  const distance = outside + Math.min(Math.max(outX, outY, outZ), 0) - rounding
  return Math.max(0, radius - distance)
}

export function boxPenetration(radii: Vector3, local: Vector3, radius: number) {
  const slack = Math.min(
    radii.x + radius - Math.abs(local.x),
    radii.y + radius - Math.abs(local.y),
    radii.z + radius - Math.abs(local.z),
  )
  return Math.max(0, slack)
}

export function cylinderPenetration(radii: Vector3, local: Vector3, radius: number) {
  const height = radii.y + radius - Math.abs(local.y)
  const ring = Math.hypot(local.x / (radii.x + radius), local.z / (radii.z + radius))
  return height > 0 && ring < 1 ? Math.min(height, (1 - ring) * Math.min(radii.x, radii.z)) : 0
}

/** The deepest a sphere reaches into any of `volumes`, in rig units. */
export function deepestPenetration(volumes: BodyVolume[], center: Vector3, radius: number) {
  return Math.max(0, ...volumes.map((volume) => penetration(volume, center, radius)))
}
