import { PerspectiveCamera, Vector3 } from 'three'
import { describe, expect, it } from 'vitest'
import type { Vec3 } from '../../data/models'
import type { PitchResult } from '../game/derbyScore'
import { cameraPanelLayout } from '../ui/cameraPanelLayout'
import {
  battingFramePoints,
  battingShot,
  type CameraShot,
  centreInBand,
  createCameraRig,
  isShowcaseHomeRun,
} from './cameraShots'

const sides = ['right', 'left'] as const

function cameraFor(shot: CameraShot, aspect: number) {
  const camera = new PerspectiveCamera(shot.fov, aspect, 0.1, 1000)
  camera.position.set(shot.position.x, shot.position.y, shot.position.z)
  camera.lookAt(shot.look.x, shot.look.y, shot.look.z)
  camera.updateMatrixWorld()
  return camera
}

function onScreen(camera: PerspectiveCamera, point: Vec3) {
  return new Vector3(point.x, point.y, point.z).project(camera)
}

function homeRun(distanceDecimetres: number): PitchResult {
  return {
    outcome: 'homeRun',
    distanceDecimetres,
    spray: 0,
    launchDegrees: 35,
    pitchType: 'fastball',
    timing: 'perfect',
    errorMs: 0,
  }
}

const hit: PitchResult = { ...homeRun(600), outcome: 'hit' }

describe('camera shots', () => {
  it('gives the full home run show only to the first home run and to each one longer than all before it', () => {
    const run = [hit, homeRun(1100), homeRun(1050), hit, homeRun(1200), homeRun(1200), homeRun(1250)]
    const showcased = run.map((result, index) => isShowcaseHomeRun(run.slice(0, index), result))
    expect(showcased).toEqual([false, true, false, false, true, false, true])
  })

  it('fits the batting shot into the band beside the camera panel, never under it, at 16:9 and 4:3', () => {
    const screens = [
      { width: 1440, height: 810 },
      { width: 1024, height: 768 },
    ]
    const playing = { screen: 'play', chasing: false, searching: false, waiting: false, size: 'large' } as const
    screens.forEach((screen) =>
      sides.forEach((side) => {
        const { band } = cameraPanelLayout(playing, screen, side)
        const camera = cameraFor(battingShot(band.width / screen.height, side), screen.width / screen.height)
        centreInBand(camera, createCameraRig(), band, screen.width, screen.height, 0, true)
        const xs = battingFramePoints(side).map((point) => ((onScreen(camera, point).x + 1) / 2) * screen.width)
        const bandLeft = band.centre - band.width / 2
        expect(Math.min(...xs)).toBeGreaterThanOrEqual(bandLeft)
        expect(Math.max(...xs)).toBeLessThanOrEqual(bandLeft + band.width)
      }),
    )
  })
})
