import { Color, Matrix4, Object3D, type InstancedMesh } from 'three'
import { clamp01 } from '../../motionMath'
import type { GroundSurface } from '../environment/groundSurface'

export const SKID_MARK_CAPACITY = 120
const SKID_MARK_SECONDS = 6
const SKID_MARK_FADE_SECONDS = 1.5
/** Scaled to nothing, for an instance slot with no mark in it. */
export const HIDDEN_MARK = new Matrix4().makeScale(0, 0, 0)
export const SKID_MARK_COLORS = { path: new Color('#9c8259'), snow: new Color('#b3c2c6'), grass: new Color('#557a45') }
const placement = new Object3D()

/** A short scuff left by a sliding shoe on a path or in snow, as Animal Crossing leaves on dirt. */
export type SkidMark = { x: number; y: number; z: number; angle: number; surface: GroundSurface; bornAt: number }

export type SkidMarkTrail = { marks: Array<SkidMark | null>; next: number; changed: boolean }

export function createSkidMarkTrail(): SkidMarkTrail {
  return { marks: Array.from({ length: SKID_MARK_CAPACITY }, () => null), next: 0, changed: false }
}

export function addSkidMark(trail: SkidMarkTrail, mark: SkidMark) {
  trail.marks[trail.next] = mark
  trail.next = (trail.next + 1) % SKID_MARK_CAPACITY
  trail.changed = true
}

/** Marks stay crisp for a few seconds, then thin away; 0 means gone. */
export function getSkidMarkFade(age: number) {
  return clamp01((SKID_MARK_SECONDS - age) / SKID_MARK_FADE_SECONDS)
}

/** Writes the mark in `slot` to its instance, freeing the slot and hiding it once the mark has faded away. */
export function drawSkidMark(mesh: InstancedMesh, marks: SkidMarkTrail['marks'], slot: number, now: number) {
  const mark = marks[slot]
  const fade = mark ? getSkidMarkFade(now - mark.bornAt) : 0
  if (!mark || fade === 0) {
    marks[slot] = null
    mesh.setMatrixAt(slot, HIDDEN_MARK)
    return
  }
  placement.position.set(mark.x, mark.y + 0.012, mark.z)
  placement.rotation.set(0, mark.angle, 0)
  placement.scale.set(0.07 * fade, 0.006, 0.26)
  placement.updateMatrix()
  mesh.setMatrixAt(slot, placement.matrix)
  mesh.setColorAt(slot, SKID_MARK_COLORS[mark.surface])
}
