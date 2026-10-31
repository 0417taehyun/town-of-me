import { describe, expect, it } from 'vitest'
import { DIFFICULTY_RULES } from './difficulty'
import { CONTACT_DEPTH, FENCE_HEIGHT, fenceDistance, FOUL_ANGLE } from './field'
import { createFlight, FLIGHT_STEP_SECONDS, launchForLanding, sprayPoint, stepFlight } from './flight'
import { FENCE_RULES, LAUNCH_RULES, type Landing, landingFor } from './landing'

const windows = DIFFICULTY_RULES.normal.timingWindows
const start = { x: 0.08, y: 0.62, z: -CONTACT_DEPTH }
const frames = [1 / 60, 1 / 144, 1 / 30, 1 / 75]
const ballsInPlay = Array.from({ length: 29 }, (_, step) => step * 10 - 140)
  .flatMap((errorMs) =>
    [0.5, 0.8, 1.15].flatMap((power) =>
      [null, -0.3, 0, 0.1, 0.2, 0.35].map((heightError) =>
        landingFor({ errorMs, power, heightError }, windows, 'right'),
      ),
    ),
  )
  .filter((landing) => landing.outcome !== 'miss')

/** The ball's height on the step it passes the fence, for each time it does. */
function heightsAtFence(landing: Landing) {
  const flight = createFlight(start, launchForLanding(landing, start))
  return Array.from({ length: 2000 }, () => {
    const crossedBefore = flight.crossedFence
    stepFlight(flight, FLIGHT_STEP_SECONDS)
    return flight.crossedFence && !crossedBefore ? flight.position.y : null
  }).filter((height) => height !== null)
}

describe('batted ball flight', () => {
  it('comes down within 0.5 m of where the landing decided, at any frame rate', () => {
    expect(new Set(ballsInPlay.map((landing) => landing.outcome))).toEqual(new Set(['homeRun', 'hit', 'foul']))
    ballsInPlay.forEach((landing) => {
      const flight = createFlight(start, launchForLanding(landing, start))
      Array.from({ length: 2000 }).forEach((_, frame) => stepFlight(flight, frames[frame % frames.length]))
      const spot = sprayPoint(landing.spray, landing.distanceDecimetres / 10)
      expect(flight.landed).toBe(true)
      expect(Math.hypot(flight.position.x - spot.x, flight.position.z - spot.z)).toBeLessThan(0.5)
    })
  })

  it('carries even the shortest, lowest home run over the hedge and keeps every other ball short of the fence', () => {
    const sprays = Array.from({ length: 19 }, (_, step) => ((step - 9) / 9) * FOUL_ANGLE)
    sprays.forEach((spray) => {
      const distanceDecimetres = Math.ceil((fenceDistance(spray) + FENCE_RULES.clearance) * 10)
      const shortest: Landing = {
        outcome: 'homeRun',
        distanceDecimetres,
        spray,
        launchDegrees: LAUNCH_RULES.homeRun.minimum,
      }
      const heights = heightsAtFence(shortest)
      expect(heights).toHaveLength(1)
      expect(heights[0]).toBeGreaterThan(FENCE_HEIGHT)
    })
    ballsInPlay.forEach((landing) =>
      expect(heightsAtFence(landing)).toHaveLength(landing.outcome === 'homeRun' ? 1 : 0),
    )
  })
})
