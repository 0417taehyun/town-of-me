import { describe, expect, it } from 'vitest'
import { Object3D, PerspectiveCamera, Vector3 } from 'three'
import {
  BIRD_COUNT,
  CLOUD_COUNT,
  createBirdSpecs,
  createCloudSpecs,
  getActiveAtmosphereCounts,
  getAtmospherePopulation,
  getBirdPalette,
  getBirdPartColor,
  getCloudShadowOpacity,
  PARTS_PER_BIRD,
  PUFFS_PER_CLOUD,
  setBirdTransform,
  setCloudShadowTransform,
  setCloudTransform,
  stepAtmospherePresence,
} from './skyMotion'
import { CAMERA_DEFAULTS, CAMERA_EYE_TARGET_HEIGHT } from '../../../camera/cameraConfig'
import { SAMPLE_TOWN } from '../../../testing/sampleTown'
import { advanceAtmosphereTime } from '../../environment/atmosphereMotion'
import { getSunPosition } from '../../environment/dayCycle'

const birdObjects = SAMPLE_TOWN.objects.filter(({ type }) => type === 'bird')
const birds = createBirdSpecs(birdObjects)
const clouds = createCloudSpecs(SAMPLE_TOWN.objects.filter(({ type }) => type === 'cloud'))

function townCamera(glance = 0, edge = 0) {
  const settings = CAMERA_DEFAULTS
  const camera = new PerspectiveCamera(settings.fov, 16 / 9, 0.1, 300)
  camera.position.set(edge, 1.2 + settings.height, edge + settings.distance)
  camera.lookAt(edge, 1.2 + CAMERA_EYE_TARGET_HEIGHT + Math.tan((glance * Math.PI) / 180) * settings.distance, edge)
  camera.updateMatrixWorld()
  return camera
}

function inView(point: Vector3) {
  return Math.abs(point.x) < 0.96 && Math.abs(point.y) < 0.96 && point.z > -1 && point.z < 1
}

function advanceSeconds(seconds: number, reduced: boolean) {
  return Array.from({ length: seconds * 60 }).reduce<number>((time) => advanceAtmosphereTime(time, 1 / 60, reduced), 0)
}

describe('bird and cloud motion through the actual camera projection', () => {
  it.each([false, true])('produces meaningful cloud drift and bird translation/flapping (reduced=%s)', (reduced) => {
    const transform = new Object3D()
    const time = advanceSeconds(5, reduced)
    setCloudTransform(transform, clouds, 0, 0)
    const cloudStart = transform.position.clone()
    setCloudTransform(transform, clouds, 0, time)
    expect(transform.position.distanceTo(cloudStart)).toBeGreaterThan(reduced ? 2.4 : 8)
    setBirdTransform(transform, birds, 12 * PARTS_PER_BIRD, 0, reduced)
    const birdStart = transform.position.clone()
    const flapStart = transform.rotation.z
    setBirdTransform(transform, birds, 12 * PARTS_PER_BIRD, time, reduced)
    expect(transform.position.distanceTo(birdStart)).toBeGreaterThan(reduced ? 2 : 8)
    expect(Math.abs(transform.rotation.z - flapStart)).toBeGreaterThan(0.01)
  })

  it.each([0, 20, 60])('brings readable world-space birds through the ordinary view near %s seconds', (elapsed) => {
    const camera = townCamera(0, 48)
    const transform = new Object3D()
    const projected = Array.from({ length: BIRD_COUNT * 4 }, (_, index) => {
      setBirdTransform(
        transform,
        birds,
        (index % BIRD_COUNT) * PARTS_PER_BIRD,
        elapsed + Math.floor(index / BIRD_COUNT),
      )
      transform.updateMatrix()
      const left = new Vector3(-0.9, 0, 0).applyMatrix4(transform.matrix).project(camera)
      const right = new Vector3(0.9, 0, 0).applyMatrix4(transform.matrix).project(camera)
      return {
        center: transform.position.clone().project(camera),
        width: Math.hypot((right.x - left.x) * 640, (right.y - left.y) * 360),
      }
    }).filter(({ center }) => inView(center))
    expect(projected.length).toBeGreaterThanOrEqual(1)
    expect(Math.max(...projected.map(({ width }) => width))).toBeGreaterThan(12)
  })

  it.each([false, true])(
    'shows noticeable near-bird screen displacement without a sky glance (reduced=%s)',
    (reduced) => {
      const camera = townCamera()
      const transform = new Object3D()
      const visible = Array.from({ length: BIRD_COUNT }, (_, bird) => {
        setBirdTransform(transform, birds, bird * PARTS_PER_BIRD, 0, reduced)
        const start = transform.position.clone().project(camera)
        setBirdTransform(transform, birds, bird * PARTS_PER_BIRD, advanceSeconds(1, reduced), reduced)
        const end = transform.position.clone().project(camera)
        return { start, end, pixels: Math.hypot((end.x - start.x) * 640, (end.y - start.y) * 360) }
      }).filter(({ start, end }) => inView(start) && inView(end))
      expect(visible.length).toBeGreaterThanOrEqual(1)
      expect(Math.max(...visible.map(({ pixels }) => pixels))).toBeGreaterThan(reduced ? 1.5 : 20)
    },
  )

  it.each([0, 20, 60])('keeps a moving cloud in a modest sky glance at the town edge at %s seconds', (elapsed) => {
    const camera = townCamera(25, 48)
    const transform = new Object3D()
    const visibleClouds = Array.from({ length: CLOUD_COUNT }, (_, cluster) => {
      setCloudTransform(transform, clouds, cluster * PUFFS_PER_CLOUD, elapsed)
      return transform.position.clone().project(camera)
    }).filter(inView)
    expect(visibleClouds.length).toBeGreaterThanOrEqual(1)
  })

  it.each([false, true])('moves visible clouds across the screen in a sky glance (reduced=%s)', (reduced) => {
    const camera = townCamera(25)
    const transform = new Object3D()
    const displacements = Array.from({ length: CLOUD_COUNT }, (_, cluster) => {
      setCloudTransform(transform, clouds, cluster * PUFFS_PER_CLOUD, 0)
      const start = transform.position.clone().project(camera)
      setCloudTransform(transform, clouds, cluster * PUFFS_PER_CLOUD, advanceSeconds(5, reduced))
      const end = transform.position.clone().project(camera)
      return { start, end, pixels: Math.hypot((end.x - start.x) * 640, (end.y - start.y) * 360) }
    }).filter(({ start, end }) => inView(start) && inView(end))
    expect(displacements.length).toBeGreaterThanOrEqual(1)
    expect(Math.max(...displacements.map(({ pixels }) => pixels))).toBeGreaterThan(reduced ? 20 : 60)
  })

  it('keeps seeded world positions unchanged when only the player/camera moves', () => {
    const transform = new Object3D()
    const camera = townCamera()
    setCloudTransform(transform, clouds, 20, 1)
    const cloud = transform.position.clone()
    setBirdTransform(transform, birds, 18 * PARTS_PER_BIRD, 1)
    const bird = transform.position.clone()
    camera.position.set(48, 9.4, 58.5)
    camera.updateMatrixWorld()
    setCloudTransform(transform, clouds, 20, 1)
    expect(transform.position.distanceTo(cloud)).toBe(0)
    setBirdTransform(transform, birds, 18 * PARTS_PER_BIRD, 1)
    expect(transform.position.distanceTo(bird)).toBe(0)
    const sunPosition = getSunPosition('noon')
    setCloudShadowTransform(transform, clouds, 5, 1, sunPosition)
    const shadow = transform.position.clone()
    expect(shadow.y).toBe(0.025)
    expect(transform.rotation.x).toBe(-Math.PI / 2)
    setCloudShadowTransform(transform, clouds, 5, 6, sunPosition)
    const shadowDisplacement = transform.position.clone().sub(shadow)
    setCloudTransform(transform, clouds, 20, 6)
    expect(transform.position.clone().sub(cloud).distanceTo(shadowDisplacement)).toBeCloseTo(0)
  })

  it('projects cloud shadows along solar rays and lengthens them near the horizon', () => {
    const transform = new Object3D()
    const sun = getSunPosition('morning')
    setCloudTransform(transform, clouds, 3 * PUFFS_PER_CLOUD + 1, 4)
    const cloud = transform.position.clone()
    setCloudShadowTransform(transform, clouds, 3, 4, sun)
    const projection = cloud.y / sun[1]
    expect(transform.position.x).toBeCloseTo(cloud.x - sun[0] * projection)
    expect(transform.position.z).toBeCloseTo(cloud.z - sun[2] * projection)

    setCloudShadowTransform(transform, clouds, 3, 4, getSunPosition('noon'))
    const noonLength = transform.scale.y
    setCloudShadowTransform(transform, clouds, 3, 4, getSunPosition('sunset'))
    expect(transform.scale.y).toBeGreaterThan(noonLength)
    expect(getCloudShadowOpacity(getSunPosition('noon'), 2.2)).toBeGreaterThan(0.06)
  })

  it('uses independent stable directions and speeds, and stays within world wrap bounds', () => {
    const transform = new Object3D()
    const velocities = [6, 7, 8].map((bird) => {
      setBirdTransform(transform, birds, bird * PARTS_PER_BIRD + 2, 0)
      const start = transform.position.clone()
      setBirdTransform(transform, birds, bird * PARTS_PER_BIRD + 2, 1)
      return transform.position.clone().sub(start)
    })
    expect(velocities[0].distanceTo(velocities[1])).toBeGreaterThan(0.5)
    expect(velocities[1].distanceTo(velocities[2])).toBeGreaterThan(0.5)
    Array.from({ length: BIRD_COUNT }, (_, index) => index).forEach((bird) => {
      setBirdTransform(transform, birds, bird * PARTS_PER_BIRD + 2, 99999)
      expect(Math.abs(transform.position.x)).toBeLessThanOrEqual(78)
      expect(Math.abs(transform.position.z)).toBeLessThanOrEqual(78)
    })
  })

  it("scales the time-of-day populations to the town's own birds and clouds", () => {
    expect(getActiveAtmosphereCounts('evening', BIRD_COUNT, CLOUD_COUNT)).toEqual(getAtmospherePopulation('evening'))
    expect(getActiveAtmosphereCounts('morning', 2, 1)).toEqual({ birds: 2, clouds: 1 })
  })

  it('starts each bird and cloud exactly at its placed anchor and follows its heading', () => {
    const transform = new Object3D()
    const [bird] = birdObjects
    setBirdTransform(transform, birds, 2, 0)
    expect(transform.position.x).toBeCloseTo(bird.position.x)
    expect(transform.position.z).toBeCloseTo(bird.position.z)
    const [eastbound] = createBirdSpecs([{ ...bird, position: { x: 0, y: 7, z: 0 }, rotation: -Math.PI / 2 }])
    setBirdTransform(transform, [eastbound], 2, 2)
    expect(transform.position.x).toBeGreaterThan(Math.abs(transform.position.z))
    const recolored = createBirdSpecs([{ ...bird, color: '#ff0000' }])[0]
    expect(getBirdPartColor(recolored.palette, 2)).toBe('#ff0000')
  })

  it('gives birds smooth seeded wandering instead of fixed straight paths', () => {
    const transform = new Object3D()
    setBirdTransform(transform, birds, 10 * PARTS_PER_BIRD + 2, 0)
    const start = transform.position.clone()
    setBirdTransform(transform, birds, 10 * PARTS_PER_BIRD + 2, 2)
    const middle = transform.position.clone()
    setBirdTransform(transform, birds, 10 * PARTS_PER_BIRD + 2, 4)
    const end = transform.position.clone()
    expect(middle.clone().sub(start).angleTo(end.clone().sub(middle))).toBeGreaterThan(0.01)
    expect(Math.abs(start.y - end.y)).toBeGreaterThan(0.05)
  })

  it('gives every bird visible eyes and a separate flight lane', () => {
    const transform = new Object3D()
    const centers = Array.from({ length: BIRD_COUNT }, (_, bird) => {
      setBirdTransform(transform, birds, bird * PARTS_PER_BIRD + 2, 20)
      return transform.position.clone()
    })
    centers.forEach((center, index) =>
      centers.slice(index + 1).forEach((other) => expect(center.distanceTo(other)).toBeGreaterThan(0.85)),
    )
    setBirdTransform(transform, birds, 6, 0)
    expect(transform.scale.x).toBeGreaterThan(0)
    expect(getBirdPartColor(getBirdPalette('sparrow'), 6)).toBe(getBirdPalette('sparrow').eye)
  })

  it('fades birds and clouds in and out over the fade instead of switching them, drawing the leaving ones until gone', () => {
    const presence = Float32Array.from([1, 1, 1, 0])
    expect(stepAtmospherePresence(presence, 1, 1.5, 3)).toBe(3)
    expect(Array.from(presence)).toEqual([1, 0.5, 0.5, 0])
    expect(stepAtmospherePresence(presence, 4, 0.75, 3)).toBe(4)
    expect(Array.from(presence)).toEqual([1, 0.75, 0.75, 0.25])
    expect(stepAtmospherePresence(presence, 1, 3, 3)).toBe(1)
    expect(Array.from(presence)).toEqual([1, 0, 0, 0])
  })
})
