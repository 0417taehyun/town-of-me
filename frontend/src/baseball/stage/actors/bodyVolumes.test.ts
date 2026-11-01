import { type Mesh, type Object3D, Quaternion, Vector3 } from 'three'
import { describe, expect, it } from 'vitest'
import { DEFAULT_PLAYER_PROFILE } from '../../../data/playerProfile'
import { batterPoseAt, createBatter, judgeSwing, poseBatter } from './batter'
import { ellipsoidPenetration, legVolumes, segmentDistance } from './bodyVolumes'
import { CONTACT_DELAY_MS } from './swingMotion'

/** `mesh`'s center and turn in its rig's frame, the space of its `root`. */
function inRigFrame(mesh: Mesh, root: Object3D) {
  root.updateMatrixWorld(true)
  const center = root.worldToLocal(mesh.getWorldPosition(new Vector3()))
  const turn = root.getWorldQuaternion(new Quaternion()).invert().multiply(mesh.getWorldQuaternion(new Quaternion()))
  return { center, turn }
}

describe('body volumes', () => {
  it('put the hips, the legs, and the shoes where the rig draws them, however the legs are posed', () => {
    const batter = createBatter({ ...DEFAULT_PLAYER_PROFILE, bottom: 'relaxed trousers', shoes: 'boots' }, 'right')
    judgeSwing(batter, 0, 0, CONTACT_DELAY_MS, null, 1)
    for (const nowMs of [-500, 30, 200, 1300]) {
      poseBatter(batter, batterPoseAt(batter, nowMs, 1, false))
      const { rig } = batter
      const meshes = [rig.pelvis, rig.legs[0], rig.knees[0], rig.feet[0], rig.legs[1], rig.knees[1], rig.feet[1]].map(
        (group) => group.children.find((child): child is Mesh => (child as Mesh).isMesh)!,
      )
      const volumes = legVolumes(rig)
      meshes.forEach((mesh, index) => {
        const { center, turn } = inRigFrame(mesh, rig.root)
        expect(volumes[index].center.distanceTo(center)).toBeLessThan(1e-9)
        expect(volumes[index].inverse.clone().multiply(turn).angleTo(new Quaternion())).toBeLessThan(1e-6)
      })
    }
  })

  it('measure how deep a ball sits in an ellipsoid as deep along its long axes as along its short one', () => {
    // A bob's side hair: narrow across, long down and back.
    const radii = new Vector3(0.12, 0.36, 0.31)
    const touching = [new Vector3(0.12 + 0.05, 0, 0), new Vector3(0, 0.36 + 0.05, 0), new Vector3(0, 0, -0.31 - 0.05)]
    for (const center of touching) expect(ellipsoidPenetration(radii, center, 0.06)).toBeCloseTo(0.01, 4)
    expect(ellipsoidPenetration(radii, new Vector3(0, 0.36 + 0.07, 0), 0.06)).toBe(0)
  })

  it('measure the shortest distance between two segments, ends included', () => {
    const point = (x: number, y: number, z: number) => new Vector3(x, y, z)
    expect(segmentDistance(point(-1, 0, 0), point(1, 0, 0), point(0, -1, 0.5), point(0, 1, 0.5))).toBeCloseTo(0.5, 9)
    expect(segmentDistance(point(0, 0, 0), point(1, 0, 0), point(0, 0.3, 0), point(1, 0.3, 0))).toBeCloseTo(0.3, 9)
    expect(segmentDistance(point(0, 0, 0), point(1, 0, 0), point(2, 1, 0), point(3, 1, 0))).toBeCloseTo(Math.SQRT2, 9)
    expect(segmentDistance(point(0, 0, 0), point(1, 0, 0), point(1.5, -1, 0), point(1.5, 1, 0))).toBeCloseTo(0.5, 9)
  })
})
