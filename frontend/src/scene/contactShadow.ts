import {
  DataTexture,
  LinearFilter,
  Vector3,
  type Group,
  type Mesh,
  type MeshBasicMaterial,
  type PlaneGeometry,
} from 'three'
import type { TownObject } from '../data/models'
import { clamp, clamp01, smoothstep } from '../motionMath'

/** Just above the ground layers (0 to 0.006) and the snow (0.003), so the patches never fight them. */
export const CONTACT_SHADOW_GROUND_Y = 0.02
export const CONTACT_SHADOW_RENDER_ORDER = 1
export const CONTACT_SHADOW_COLOR = '#1f2a30'
export const CHARACTER_SHADOW_OPACITY = 0.42
export const OBJECT_SHADOW_OPACITY = 0.38
const CONTACT_SHADOW_FADE_HEIGHT = 1.4
// The texture is darkest in the middle, so a patch reaches past the footprint for its dark part to meet the walls.
const FOOTPRINT_SPREAD = 1.6
const TEXTURE_SIZE = 64
const shadowParentPosition = new Vector3()

export type ContactShadowPatch = { x: number; z: number; width: number; depth: number; rotation: number }

/** 1 with the body on the ground, falling to 0 as it rises to the fade height. */
export function getContactShadowFade(height: number) {
  return 1 - clamp(height, 0, CONTACT_SHADOW_FADE_HEIGHT) / CONTACT_SHADOW_FADE_HEIGHT
}

export function patchUnder(object: TownObject, footprintWidth: number, footprintDepth: number): ContactShadowPatch {
  return {
    x: object.position.x,
    z: object.position.z,
    width: footprintWidth * FOOTPRINT_SPREAD,
    depth: footprintDepth * FOOTPRINT_SPREAD,
    rotation: object.rotation,
  }
}

export function roundPatchUnder(object: TownObject, diameter: number) {
  return patchUnder(object, diameter, diameter)
}

/** White with a smoothstep alpha falloff, so the material color tints it and the middle stays evenly dark. */
export function createContactShadowTexture() {
  const data = new Uint8Array(TEXTURE_SIZE * TEXTURE_SIZE * 4).fill(255)
  for (let index = 0; index < TEXTURE_SIZE * TEXTURE_SIZE; index += 1) {
    const x = ((index % TEXTURE_SIZE) / (TEXTURE_SIZE - 1)) * 2 - 1
    const y = (Math.floor(index / TEXTURE_SIZE) / (TEXTURE_SIZE - 1)) * 2 - 1
    data[index * 4 + 3] = Math.round(255 * smoothstep(clamp01((1 - Math.hypot(x, y)) / 0.8)))
  }
  const texture = new DataTexture(data, TEXTURE_SIZE, TEXTURE_SIZE)
  texture.magFilter = LinearFilter
  texture.minFilter = LinearFilter
  texture.needsUpdate = true
  return texture
}

export const contactShadowTexture = createContactShadowTexture()

export type ContactShadowMesh = Mesh<PlaneGeometry, MeshBasicMaterial>

/** Shrinks and fades a character's blob as the body lifts off the ground. */
export function fadeContactShadow(shadow: ContactShadowMesh | null, height: number) {
  if (!shadow) return
  const fade = getContactShadowFade(height)
  shadow.scale.setScalar(0.6 + 0.4 * fade)
  shadow.material.opacity = CHARACTER_SHADOW_OPACITY * fade
}

/** Keeps the blob on the ground under the body at whatever height the parent carries the character. */
export function placeCharacterShadow(shadow: ContactShadowMesh | null, body: Group) {
  if (!shadow?.parent) return
  const parentY = shadow.parent.getWorldPosition(shadowParentPosition).y
  shadow.position.set(body.position.x, CONTACT_SHADOW_GROUND_Y - parentY, body.position.z)
  fadeContactShadow(shadow, parentY + body.position.y)
}
