import { describe, expect, it } from 'vitest'
import { Object3D, Vector3 } from 'three'
import { advanceAtmosphereTime } from '../../environment/atmosphereMotion'
import { FOUNTAIN_DROPS, getFountainFlow, setFountainDrop, setFountainRipple } from './fountainMotion'

describe('lightweight fountain water', () => {
  it.each([1, 0.3])('keeps all three jets above the pool and within its rim at flow %s', (flow) => {
    const transform = new Object3D()
    Array.from({ length: FOUNTAIN_DROPS }, (_, index) => index).forEach((index) => {
      setFountainDrop(transform, index, 3, flow)
      expect(transform.position.y).toBeGreaterThanOrEqual(0.315)
      expect(Math.hypot(transform.position.x, transform.position.z)).toBeLessThan(2.06)
    })
  })
  it.each([false, true])('moves the water and expands ripples with reduced=%s', (reduced) => {
    const transform = new Object3D()
    const elapsed = advanceAtmosphereTime(0, 0.1, reduced)
    setFountainDrop(transform, 0, 0)
    const start = transform.position.clone()
    setFountainDrop(transform, 0, elapsed)
    expect(transform.position.distanceTo(start)).toBeGreaterThan(reduced ? 0.05 : 0.2)
    setFountainRipple(transform, 0, 0)
    const radius = transform.scale.x
    setFountainRipple(transform, 0, elapsed)
    expect(transform.scale.x).toBeGreaterThan(radius)
    expect(transform.position.y).toBe(0.315)
  })
  it('stretches each drop along its flight, longer where it flies faster', () => {
    const transform = new Object3D()
    const drops = Array.from({ length: FOUNTAIN_DROPS }, (_, index) => {
      setFountainDrop(transform, index, 3.001)
      const later = transform.position.clone()
      setFountainDrop(transform, index, 3)
      const motion = later.sub(transform.position)
      const axis = new Vector3(0, 1, 0).applyQuaternion(transform.quaternion)
      return { speed: motion.length(), alignment: axis.dot(motion.normalize()), length: transform.scale.y }
      // A drop relaunching between the two moments jumps back to the column.
    }).filter(({ speed }) => speed < 0.05)
    drops.forEach(({ alignment }) => expect(alignment).toBeGreaterThan(0.98))
    drops.sort((first, second) => first.speed - second.speed)
    expect(drops.at(-1)!.length).toBeGreaterThan(drops[0].length)
  })
  it('runs the jet until the snow cover passes about half and stops it under deep snow', () => {
    expect(getFountainFlow(0.3)).toBe(1)
    expect(getFountainFlow(0.5)).toBeCloseTo(0.5)
    expect(getFountainFlow(0.7)).toBe(0)
    const transform = new Object3D()
    setFountainDrop(transform, 5, 3, getFountainFlow(0.9))
    expect(transform.scale.y).toBe(0)
  })
})
