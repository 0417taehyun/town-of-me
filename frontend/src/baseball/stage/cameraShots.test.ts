import { PerspectiveCamera, Vector3 } from 'three'
import { describe, expect, it } from 'vitest'
import type { Vec3 } from '../../data/models'
import type { PitchResult } from '../game/derbyScore'
import { FENCE_HEIGHT, fenceDistance } from '../game/field'
import { sprayPoint } from '../game/flight'
import { contactSeconds, PITCH_TYPE_IDS, pitchPosition, planPitch, RELEASE_POINT } from '../game/pitch'
import { PITCH_TARGET_BAND } from '../game/pitchSchedule'
import { DUGOUT_SPOTS } from '../stadium/fieldLayout'
import { cameraPanelLayout } from '../ui/cameraPanelLayout'
import {
  battingFramePoints,
  battingShot,
  type CameraShot,
  centreInBand,
  chaseShot,
  createCameraRig,
  HUD_RESERVE,
  isShowcaseHomeRun,
  wideShot,
} from './cameraShots'

const aspects = [16 / 9, 4 / 3]
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

function inHudFreeBand(camera: PerspectiveCamera, point: Vec3) {
  const { x, y } = onScreen(camera, point)
  return Math.abs(x) <= 1 && y <= 1 - 2 * HUD_RESERVE.top && y >= -(1 - 2 * HUD_RESERVE.bottom)
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

  it('keeps the release point, home plate, and every pitch up to the bat between the HUD bands at 16:9 and 4:3', () => {
    const plate = [
      { x: -0.215, y: 0, z: -0.215 },
      { x: 0.215, y: 0, z: -0.215 },
      { x: 0, y: 0, z: 0.215 },
    ]
    const targets = [PITCH_TARGET_BAND.low, PITCH_TARGET_BAND.high].flatMap((y) =>
      [-PITCH_TARGET_BAND.side, PITCH_TARGET_BAND.side].map((x) => ({ x, y })),
    )
    const pitchPaths = PITCH_TYPE_IDS.flatMap((type) =>
      targets.flatMap((target) => {
        const plan = planPitch(type, 0.85, target)
        const seconds = contactSeconds(plan)
        return Array.from({ length: 21 }, (_, step) => pitchPosition(plan, (seconds * step) / 20))
      }),
    )
    aspects.forEach((aspect) =>
      sides.forEach((side) => {
        const camera = cameraFor(battingShot(aspect, side), aspect)
        ;[RELEASE_POINT, ...plate, ...pitchPaths].forEach((point) => expect(inHudFreeBand(camera, point)).toBe(true))
      }),
    )
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

  it('chases every ball, fair or foul, from well clear of both dugouts', () => {
    const sprays = [-1.15, -0.95, -0.8, -0.6, 0, 0.6, 0.8, 0.95, 1.15]
    const balls = sprays.flatMap((spray) =>
      [5, 20, 40, 60, 80, 100].flatMap((distance) => [0.5, 8, 25].map((y) => ({ ...sprayPoint(spray, distance), y }))),
    )
    const closest = Math.min(
      ...balls.flatMap((ball) => {
        const { position } = chaseShot(ball)
        return DUGOUT_SPOTS.map((dugout) => Math.hypot(position.x - dugout.x, position.z - dugout.z))
      }),
    )
    expect(closest).toBeGreaterThan(9)
  })

  it('chases a ball from behind home plate, under the HUD, with the hedge in view unless it pops up steeply', () => {
    // Points (distance, height in m) along a high home run's arc, then a steep pop near home.
    const arc = [
      [10, 4],
      [30, 28],
      [60, 30],
      [100, 25],
      [140, 12],
    ]
    const popUp = [15, 30]
    aspects.forEach((aspect) =>
      [-0.7, 0, 0.7].forEach((spray) =>
        [...arc, popUp].forEach(([distance, y]) => {
          const ball = { ...sprayPoint(spray, distance), y }
          const shot = chaseShot(ball)
          const camera = cameraFor(shot, aspect)
          const seen = onScreen(camera, ball)
          const hedge = sprayPoint(spray, fenceDistance(spray))
          const hedgeSeen = onScreen(camera, { x: hedge.x, y: FENCE_HEIGHT, z: hedge.z }).y > -1
          expect(shot.position.z).toBeGreaterThan(0)
          expect(Math.abs(seen.x)).toBeLessThan(1)
          expect(seen.y).toBeLessThan(1 - 2 * HUD_RESERVE.top)
          expect(hedgeSeen || distance === popUp[0]).toBe(true)
        }),
      ),
    )
  })

  it('cuts to a landing camera that sees the ball clear the hedge and come down', () => {
    const homeRuns = [-0.7, -0.3, 0, 0.4, 0.7].flatMap((spray) =>
      [fenceDistance(spray) + 5, 155].map((distance) => ({ spray, distance })),
    )
    aspects.forEach((aspect) =>
      homeRuns.forEach(({ spray, distance }) => {
        const camera = cameraFor(wideShot(spray, distance), aspect)
        const fence = sprayPoint(spray, fenceDistance(spray))
        const landing = sprayPoint(spray, distance)
        const clearing = onScreen(camera, { x: fence.x, y: FENCE_HEIGHT + 2, z: fence.z })
        const comingDown = onScreen(camera, { x: landing.x, y: 0.1, z: landing.z })
        ;[clearing, comingDown].forEach((point) => {
          expect(Math.max(Math.abs(point.x), Math.abs(point.y))).toBeLessThan(0.95)
          expect(point.z).toBeLessThan(1)
        })
      }),
    )
  })
})
