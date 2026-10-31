import {
  BufferAttribute,
  BufferGeometry,
  CapsuleGeometry,
  Color,
  ConeGeometry,
  CylinderGeometry,
  Euler,
  Matrix4,
  Quaternion,
  SphereGeometry,
  TorusGeometry,
  Vector3,
} from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import type { AvatarPart } from './avatarAppearance'
import { getRoundedBox } from '../roundedBox'

/**
 * Unit shapes shared by every character's face, hair, and hands; each part scales them. Built once, at the segment
 * counts a head-sized shape needs, instead of once per part per character.
 */
export const characterGeometries = {
  box: getRoundedBox(1, 1, 1, 0.18),
  sphere: new SphereGeometry(1, 14, 10),
  cone: new ConeGeometry(1, 1, 10),
  cylinder: new CylinderGeometry(1, 1, 1, 12),
  arc: new TorusGeometry(1, 0.16, 6, 14, Math.PI),
  smallSphere: new SphereGeometry(1, 10, 6),
  happyEye: new TorusGeometry(0.052, 0.012, 6, 12, Math.PI),
  hand: new CapsuleGeometry(0.09, 0.16, 3, 8),
}

const partColor = new Color()
const partMatrix = new Matrix4()
const partTurn = new Quaternion()
const partAngles = new Euler()
const partPosition = new Vector3()
const partScale = new Vector3()

/** One avatar part as its own geometry, placed and colored the way its mesh would draw it. */
export function bakeAvatarPart(part: AvatarPart) {
  const geometry = characterGeometries[part.shape].clone()
  // mergeGeometries needs every part indexed or none; the rounded box comes unindexed, the other shapes indexed.
  if (!geometry.index)
    geometry.setIndex(Array.from({ length: geometry.attributes.position.count }, (_, index) => index))
  partTurn.setFromEuler(partAngles.set(...(part.rotation ?? [0, 0, 0])))
  geometry.applyMatrix4(partMatrix.compose(partPosition.set(...part.position), partTurn, partScale.set(...part.scale)))
  partColor.set(part.color)
  const colors = new Float32Array(geometry.attributes.position.count * 3)
  for (let index = 0; index < colors.length; index += 3) partColor.toArray(colors, index)
  geometry.setAttribute('color', new BufferAttribute(colors, 3))
  return geometry
}

/** Bakes the parts that never change, such as hair, hat, and ears, into one geometry: a head in one draw, not a dozen. */
export function mergeAvatarParts(parts: AvatarPart[]) {
  const baked = parts.map(bakeAvatarPart)
  const merged = mergeGeometries(baked) ?? new BufferGeometry()
  baked.forEach((geometry) => geometry.dispose())
  return merged
}
