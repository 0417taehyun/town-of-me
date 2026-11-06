import { describe, expect, it } from 'vitest'
import { Object3D } from 'three'
import {
  BIRD_COUNT,
  CLOUD_COUNT,
  createBirdSpecs,
  createCloudSpecs,
  getActiveAtmosphereCounts,
  getBirdPartColor,
  getCloudShadowOpacity,
  PARTS_PER_BIRD,
  PUFFS_PER_CLOUD,
  setBirdTransform,
  setCloudShadowTransform,
  setCloudTransform,
  stepAtmospherePresence,
} from './skyMotion'
import { SAMPLE_TOWN } from '../../../testing/sampleTown'
import { getSunPosition } from '../../environment/dayCycle'

const birdObjects = SAMPLE_TOWN.objects.filter(({ type }) => type === 'bird')
const birds = createBirdSpecs(birdObjects)
const clouds = createCloudSpecs(SAMPLE_TOWN.objects.filter(({ type }) => type === 'cloud'))

describe('bird and cloud motion', () => {
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

  it("scales the time-of-day populations to the town's own birds and clouds, rounding up", () => {
    const seedTown = getActiveAtmosphereCounts('evening', BIRD_COUNT, CLOUD_COUNT)
    expect(getActiveAtmosphereCounts('evening', BIRD_COUNT * 2, CLOUD_COUNT * 3)).toEqual({
      birds: seedTown.birds * 2,
      clouds: seedTown.clouds * 3,
    })
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
