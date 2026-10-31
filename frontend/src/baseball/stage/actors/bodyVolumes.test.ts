import { type Mesh, type Object3D, Quaternion, Vector3 } from 'three'
import { describe, expect, it } from 'vitest'
import { DEFAULT_PLAYER_PROFILE } from '../../../data/playerProfile'
import { batterPoseAt, createBatter, poseBatter, startSwing } from './batter'
import { legVolumes, segmentDistance } from './bodyVolumes'

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
    startSwing(batter, 0, 1, null)
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

  it('measure the shortest distance between two segments, ends included', () => {
    const point = (x: number, y: number, z: number) => new Vector3(x, y, z)
    expect(segmentDistance(point(-1, 0, 0), point(1, 0, 0), point(0, -1, 0.5), point(0, 1, 0.5))).toBeCloseTo(0.5, 9)
    expect(segmentDistance(point(0, 0, 0), point(1, 0, 0), point(0, 0.3, 0), point(1, 0.3, 0))).toBeCloseTo(0.3, 9)
    expect(segmentDistance(point(0, 0, 0), point(1, 0, 0), point(2, 1, 0), point(3, 1, 0))).toBeCloseTo(Math.SQRT2, 9)
    expect(segmentDistance(point(0, 0, 0), point(1, 0, 0), point(1.5, -1, 0), point(1.5, 1, 0))).toBeCloseTo(0.5, 9)
  })
})
