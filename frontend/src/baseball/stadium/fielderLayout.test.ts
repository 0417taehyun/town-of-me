import { describe, expect, it } from 'vitest'
import { fenceDistance, FOUL_ANGLE } from '../game/field'
import { createMover, FIELDER_SPOTS, reachableSpot, sendChase } from './fielderLayout'

describe('the fielders chasing a ball in play', () => {
  it('runs only to fair ground inside the hedge, and keeps a fair landing inside it as it is', () => {
    const landings = [
      { x: 0, z: -140 },
      { x: 90, z: -20 },
      { x: -60, z: -10 },
      { x: 3, z: 12 },
      { x: 70, z: -70 },
    ]
    landings.map(reachableSpot).forEach((spot) => {
      const spray = Math.atan2(spot.x, -spot.z)
      expect(Math.abs(spray)).toBeLessThan(FOUL_ANGLE)
      expect(Math.hypot(spot.x, spot.z)).toBeLessThan(fenceDistance(spray))
    })
    const fair = reachableSpot({ x: -12, z: -50 })
    expect(fair.x).toBeCloseTo(-12)
    expect(fair.z).toBeCloseTo(-50)
  })

  it('sends the fielder nearest the ball for it and only one other to back him up', () => {
    const fielders = FIELDER_SPOTS.map((spot) => createMover(spot, 0))
    sendChase(fielders, { x: 26, z: -52 })
    expect(fielders.map((fielder) => fielder.target !== null)).toEqual([false, true, false, false, false, false, true])
    expect(fielders[6].target).toEqual(reachableSpot({ x: 26, z: -52 }))
    expect(fielders[6].speed).toBeGreaterThan(fielders[1].speed)
  })
})
