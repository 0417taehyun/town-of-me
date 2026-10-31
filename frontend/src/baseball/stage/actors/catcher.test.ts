import { type Mesh, type Object3D, Vector3 } from 'three'
import { describe, expect, it } from 'vitest'
import { STRIKE_ZONE } from '../../game/field'
import { PITCH_TYPE_IDS, pitchPosition, planPitch } from '../../game/pitch'
import { PITCH_TARGET_BAND } from '../../game/pitchSchedule'
import { HEAD_RANGES } from '../ballplayerCast'
import { BATTING_EYE } from '../cameraShots'
import { mittSeconds } from '../stageRun'
import { type Catcher, createCatcher, poseCatcher } from './catcher'
import { watch } from './headLook'

/** How far (m) a point reaches above the batting shot's line of sight to the bottom of the strike zone. */
function overSightLine(point: Vector3) {
  const eye = BATTING_EYE
  return point.y - (eye.y + ((STRIKE_ZONE.bottom - eye.y) * (eye.z - point.z)) / eye.z)
}

/** How far (m) the highest of a mesh's vertices reaches above that line of sight. */
function meshOverSightLine({ geometry, matrixWorld }: Mesh) {
  const positions = geometry.getAttribute('position')
  const overs = Array.from({ length: positions.count }, (_, index) =>
    overSightLine(new Vector3().fromBufferAttribute(positions, index).applyMatrix4(matrixWorld)),
  )
  return Math.max(...overs)
}

/** How far (m) the head reaches above the batting shot's line of sight to the bottom of the strike zone. */
function headOverZone(catcher: Catcher) {
  catcher.rig.root.updateMatrixWorld(true)
  const parts: Object3D[] = []
  catcher.rig.head.traverse((part) => parts.push(part))
  const meshes = parts.filter((part): part is Mesh => (part as Mesh).isMesh === true)
  return Math.max(...meshes.map(meshOverSightLine))
}

describe('catcher', () => {
  it('keeps his head under the batting shot’s view of the strike zone, wherever a pitch takes his mitt', () => {
    const corners = [-1, 1].flatMap((side) =>
      [PITCH_TARGET_BAND.low, PITCH_TARGET_BAND.high].map((y) => ({ x: side * PITCH_TARGET_BAND.side, y })),
    )
    const ends = PITCH_TYPE_IDS.flatMap((type) =>
      corners.map((corner) => {
        const plan = planPitch(type, 0.85, corner)
        return pitchPosition(plan, mittSeconds(plan))
      }),
    )
    const catcher = createCatcher(ends[0])
    const overs = ends.map((end) => {
      poseCatcher(catcher, end, 10)
      watch(catcher.rig, catcher.look, end, HEAD_RANGES.catcher, 10)
      return headOverZone(catcher)
    })
    expect(Math.max(...overs)).toBeLessThan(0)
  })
})
