import { describe, expect, it } from 'vitest'
import { Vector3 } from 'three'
import { getDayPeriod, getShadowLightPlacement, getSunPosition, SUN_SHADOW_FRAME } from './dayCycle'

describe('local day cycle', () => {
  it('changes at every local-time boundary including midnight', () => {
    const cases = [
      [0, 'evening'],
      [4, 'evening'],
      [5, 'dawn'],
      [6, 'dawn'],
      [7, 'morning'],
      [10, 'morning'],
      [11, 'noon'],
      [13, 'noon'],
      [14, 'afternoon'],
      [16, 'afternoon'],
      [17, 'sunset'],
      [19, 'sunset'],
      [20, 'evening'],
      [23, 'evening'],
    ] as const
    cases.forEach(([hour, period]) => expect(getDayPeriod(new Date(2026, 9, 4, hour, 59))).toBe(period))
  })
})

describe('sun shadow placement', () => {
  const placementFor = (focus: Vector3, sun: Vector3) =>
    getShadowLightPlacement(focus, sun, { position: new Vector3(), target: new Vector3() })

  it('moves the shadow camera in whole texels, so a walking player does not make shadow edges shimmer', () => {
    const sun = new Vector3(...getSunPosition('afternoon')).normalize()
    const texel = (SUN_SHADOW_FRAME.halfSize * 2) / SUN_SHADOW_FRAME.mapSize
    const focuses = Array.from({ length: 200 }, (_, step) => new Vector3(3.2 + step * 0.001, 0, -4.7 + step * 0.0004))
    const targets = focuses.map((focus) => placementFor(focus, sun).target)

    expect(
      new Set(
        targets.map((target) =>
          target
            .toArray()
            .map((value) => value.toFixed(5))
            .join(),
        ),
      ).size,
    ).toBeLessThan(30)
    targets.forEach((target, step) => expect(target.distanceTo(focuses[step])).toBeLessThanOrEqual(texel))
  })

  it('raises a sunset sun to the minimum shadow elevation without turning it, and leaves a high sun alone', () => {
    const lightDirection = ({ position, target }: { position: Vector3; target: Vector3 }) =>
      position.clone().sub(target).normalize()
    const sunset = new Vector3(...getSunPosition('sunset')).normalize()
    const noon = new Vector3(...getSunPosition('noon')).normalize()
    const lifted = lightDirection(placementFor(new Vector3(), sunset))

    expect(Math.asin(lifted.y)).toBeCloseTo(SUN_SHADOW_FRAME.minimumElevation, 5)
    expect(Math.atan2(lifted.x, lifted.z)).toBeCloseTo(Math.atan2(sunset.x, sunset.z), 5)
    expect(lightDirection(placementFor(new Vector3(), noon)).toArray()).toEqual(
      noon.toArray().map((value) => expect.closeTo(value, 5)),
    )
  })
})
