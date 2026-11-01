import { Euler, Matrix4, Quaternion, Vector3 } from 'three'
import { clamp } from '../../../motionMath'
import type { AvatarPart } from '../../../scene/characters/avatarAppearance'
import { BALLPLAYER_BODY, type BallplayerRig, type LegSolid, legSolids } from './ballplayerRig'

// The ballplayer's head (with its hair, hat, ears, and nose), torso, and lower body as simple solids in the rig frame,
// so the batter can keep its arms and its bat out of them. Each part is the shape its mesh draws: spheres and cones as
// ellipsoids, cylinders (a sun hat), boxes, and the rounded boxes of the torso, the hips, the legs, and the shoes.

export type BodyVolume = {
  part: 'head' | 'torso' | 'legs'
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

/** The head's solids (with its hair, hat, ears, and nose) as last posed (poseChest, turnHead), in the rig frame. */
export function headVolumes(rig: Pick<BallplayerRig, 'body' | 'head' | 'appearance'>): BodyVolume[] {
  const { body, head } = rig
  headMatrix.multiplyMatrices(body.matrix, head.matrix)
  headTurn.copy(body.quaternion).multiply(head.quaternion)
  return rig.appearance.headParts.filter(isSolidHeadPart).map((part) => headPartVolume(part, headMatrix, headTurn))
}

/** The head's solids, the torso, and the lower body as last posed (poseLegs, poseChest), in the rig frame. */
export function bodyVolumes(rig: BallplayerRig): BodyVolume[] {
  const { body } = rig
  const { torso } = BALLPLAYER_BODY
  const torsoVolume: BodyVolume = {
    part: 'torso',
    shape: 'roundedBox',
    center: new Vector3(0, torso.centerY, 0).applyMatrix4(body.matrix),
    inverse: body.quaternion.clone().invert(),
    radii: new Vector3(torso.width / 2, torso.height / 2, torso.depth / 2),
    rounding: torso.rounding,
  }
  return [...headVolumes(rig), torsoVolume, ...legVolumes(rig)]
}

const local = new Vector3()

/** Rounded box `solid` in a group posed at `position` and turned by `turn` (rig frame). */
export function legSolidVolume(solid: LegSolid, position: Vector3, turn: Quaternion): BodyVolume {
  const [width, height, depth] = solid.size
  return {
    part: 'legs',
    shape: 'roundedBox',
    center: solid.center.clone().applyQuaternion(turn).add(position),
    inverse: turn.clone().invert(),
    radii: new Vector3(width / 2, height / 2, depth / 2),
    rounding: solid.rounding,
  }
}

const kneeTurn = new Quaternion()
const kneePosition = new Vector3()

/** Leg `index`'s thigh, shin, and shoe as last posed (poseLegs), in the rig frame. */
export function oneLegVolumes(rig: BallplayerRig, index: number, solids: ReturnType<typeof legSolids>) {
  const leg = rig.legs[index]
  const knee = rig.knees[index]
  const foot = rig.feet[index]
  kneeTurn.copy(leg.quaternion).multiply(knee.quaternion)
  kneePosition.copy(knee.position).applyQuaternion(leg.quaternion).add(leg.position)
  return [
    legSolidVolume(solids.thigh, leg.position, leg.quaternion),
    legSolidVolume(solids.shin, kneePosition, kneeTurn),
    legSolidVolume(solids.shoe, foot.position, foot.quaternion),
  ]
}

/** The hips, both legs, and both shoes as last posed (poseLegs), in the rig frame. */
export function legVolumes(rig: BallplayerRig): BodyVolume[] {
  const solids = legSolids(rig.appearance)
  const hips = legSolidVolume(solids.hips, rig.pelvis.position, rig.pelvis.quaternion)
  return [hips, ...oneLegVolumes(rig, 0, solids), ...oneLegVolumes(rig, 1, solids)]
}

/** How deep a sphere (`center`, `radius`) sits inside `volume`, in rig units (0 when clear). */
export function penetration(volume: BodyVolume, center: Vector3, radius: number) {
  // Most spheres are far from most solids. None of the shapes below counts a sphere further out than its corners
  // grown by the radius along every axis (under twice the radius), so this skips only what would come out 0.
  const reach = volume.radii.length() + 2 * radius
  if (center.distanceToSquared(volume.center) >= reach * reach) return 0
  local.copy(center).sub(volume.center).applyQuaternion(volume.inverse)
  if (volume.shape === 'roundedBox') return roundedBoxPenetration(volume, local, radius)
  if (volume.shape === 'box') return boxPenetration(volume.radii, local, radius)
  if (volume.shape === 'cylinder') return cylinderPenetration(volume.radii, local, radius)
  return ellipsoidPenetration(volume.radii, local, radius)
}

/**
 * How deep a sphere of `radius` centered at `local` (in the ellipsoid's own axes) sits in an ellipsoid of `radii`: its
 * radius less the distance to the surface, taken as how far the ellipsoid's measure is off 1 over how steeply it grows
 * there, which holds along a long axis as well as a short one near the surface.
 */
export function ellipsoidPenetration(radii: Vector3, local: Vector3, radius: number) {
  const scaledX = local.x / radii.x
  const scaledY = local.y / radii.y
  const scaledZ = local.z / radii.z
  const measure = Math.hypot(scaledX, scaledY, scaledZ)
  const slope = Math.hypot(scaledX / radii.x, scaledY / radii.y, scaledZ / radii.z) / Math.max(measure, 1e-9)
  return Math.max(0, radius - (measure - 1) / Math.max(slope, 1e-9))
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
  return volumes.reduce((deepest, volume) => Math.max(deepest, penetration(volume, center, radius)), 0)
}

const firstDirection = new Vector3()
const secondDirection = new Vector3()
const between = new Vector3()
const firstClosest = new Vector3()
const secondClosest = new Vector3()

/**
 * The shortest distance between the segments from `firstStart` to `firstEnd` and from `secondStart` to `secondEnd`
 * (neither of zero length): the closest pair of points clamped into both segments (Ericson, Real-Time Collision
 * Detection 5.1.9).
 */
export function segmentDistance(firstStart: Vector3, firstEnd: Vector3, secondStart: Vector3, secondEnd: Vector3) {
  firstDirection.copy(firstEnd).sub(firstStart)
  secondDirection.copy(secondEnd).sub(secondStart)
  between.copy(firstStart).sub(secondStart)
  const firstSquared = firstDirection.lengthSq()
  const secondSquared = secondDirection.lengthSq()
  const along = firstDirection.dot(secondDirection)
  const firstOffset = firstDirection.dot(between)
  const secondOffset = secondDirection.dot(between)
  const denominator = firstSquared * secondSquared - along * along
  const parallel = denominator < 1e-12
  const first = parallel ? 0 : clamp((along * secondOffset - firstOffset * secondSquared) / denominator, 0, 1)
  const second = clamp((along * first + secondOffset) / secondSquared, 0, 1)
  const refined = clamp((along * second - firstOffset) / firstSquared, 0, 1)
  firstClosest.copy(firstStart).addScaledVector(firstDirection, refined)
  secondClosest.copy(secondStart).addScaledVector(secondDirection, second)
  return firstClosest.distanceTo(secondClosest)
}
