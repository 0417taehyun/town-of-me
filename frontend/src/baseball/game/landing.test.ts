import { describe, expect, it } from 'vitest'
import { DIFFICULTY_RULES, type TimingWindows } from './difficulty'
import { type BattingSide, fenceDistance, FOUL_ANGLE } from './field'
import { SWING_POWER_RANGE } from './judging'
import { type JudgedSwing, type Landing, landingFor, MAX_HOME_RUN_DISTANCE_DECIMETRES } from './landing'
import { createSeededRandom } from './seededRandom'

const allWindows = Object.values(DIFFICULTY_RULES).map((rule) => rule.timingWindows)
const sides: BattingSide[] = ['right', 'left']
const outcomeRank: Record<Landing['outcome'], number> = { miss: 0, foul: 1, hit: 2, homeRun: 3 }

function steps(from: number, to: number, step: number) {
  return Array.from({ length: Math.floor((to - from) / step + 1e-9) + 1 }, (_, index) => from + index * step)
}

const powers = [...steps(SWING_POWER_RANGE.minimum, SWING_POWER_RANGE.maximum, 0.05), SWING_POWER_RANGE.maximum]
const measuredHeights = steps(-0.45, 0.45, 0.05)

/** One number that orders landings: the outcome first, then the distance. */
function landingScore(landing: Landing) {
  return outcomeRank[landing.outcome] * 100000 + landing.distanceDecimetres
}

function randomSwing(random: () => number, windows: TimingWindows): JudgedSwing {
  const errorMs = windows.contact * 1.2 * (2 * random() - 1)
  const power = SWING_POWER_RANGE.minimum + (SWING_POWER_RANGE.maximum - SWING_POWER_RANGE.minimum) * random()
  const heightError = random() < 0.3 ? null : 0.6 * (2 * random() - 1)
  return { errorMs, power, heightError }
}

describe('landing', () => {
  it('lands home runs past the fence in their direction, hits fair inside it, and fouls outside the lines', () => {
    const landings = Array.from({ length: 3000 }, (_, seed) => {
      const random = createSeededRandom(seed)
      const windows = allWindows[seed % allWindows.length]
      return landingFor(randomSwing(random, windows), windows, sides[seed % 2])
    })
    const byOutcome = (outcome: Landing['outcome']) => landings.filter((landing) => landing.outcome === outcome)
    const meters = (landing: Landing) => landing.distanceDecimetres / 10
    byOutcome('homeRun').forEach((landing) => {
      expect(Math.abs(landing.spray)).toBeLessThanOrEqual(FOUL_ANGLE)
      expect(meters(landing)).toBeGreaterThan(fenceDistance(landing.spray))
    })
    byOutcome('hit').forEach((landing) => {
      expect(Math.abs(landing.spray)).toBeLessThanOrEqual(FOUL_ANGLE)
      expect(meters(landing)).toBeGreaterThan(0)
      expect(meters(landing)).toBeLessThan(fenceDistance(landing.spray))
    })
    byOutcome('foul').forEach((landing) => expect(Math.abs(landing.spray)).toBeGreaterThan(FOUL_ANGLE))
    byOutcome('miss').forEach((landing) => expect(landing.distanceDecimetres).toBe(0))
    expect(new Set(landings.map((landing) => landing.outcome))).toEqual(new Set(['homeRun', 'hit', 'foul', 'miss']))
  })

  it('never lets an unknown bat height beat the best measured one, or count as a level bat', () => {
    const deadOn = (heightError: number | null) =>
      landingFor({ errorMs: 0, power: 1, heightError }, DIFFICULTY_RULES.normal.timingWindows, 'right')
    expect(deadOn(null).distanceDecimetres).toBeLessThan(deadOn(0).distanceDecimetres)
    allWindows.forEach((windows) =>
      [0, ...steps(-windows.contact, windows.contact, 10)].forEach((errorMs) =>
        powers.forEach((power) => {
          const unknown = landingScore(landingFor({ errorMs, power, heightError: null }, windows, 'right'))
          const measured = measuredHeights.map((heightError) =>
            landingScore(landingFor({ errorMs, power, heightError }, windows, 'right')),
          )
          expect(unknown).toBeLessThanOrEqual(Math.max(...measured))
        }),
      ),
    )
  })

  it('never carries a home run past MAX_HOME_RUN_DISTANCE_DECIMETRES, which a perfect swing reaches', () => {
    // Dead on, at full power, and level, where the longest is, then the windows' edges and between, 5 ms apart.
    const longest = allWindows.map((windows) =>
      [0, ...steps(-windows.contact, windows.contact, 5)]
        .flatMap((errorMs) =>
          powers.flatMap((power) =>
            [null, ...measuredHeights].flatMap((heightError) =>
              sides.map((side) => landingFor({ errorMs, power, heightError }, windows, side).distanceDecimetres),
            ),
          ),
        )
        .reduce((farthest, distance) => Math.max(farthest, distance), 0),
    )
    expect(longest).toEqual(allWindows.map(() => MAX_HOME_RUN_DISTANCE_DECIMETRES))
  })

  it('never lands shorter for closer timing, more power, or a bat nearer the ball', () => {
    allWindows.forEach((windows) => {
      const lateness = steps(0, windows.good, 1)
      sides.forEach((side) =>
        [-1, 1].forEach((direction) => {
          const distances = lateness.map(
            (offBy) =>
              landingFor({ errorMs: direction * offBy, power: 1, heightError: 0 }, windows, side).distanceDecimetres,
          )
          distances.slice(1).forEach((distance, step) => expect(distance).toBeLessThanOrEqual(distances[step]))
          expect(distances[distances.length - 1]).toBeLessThan(distances[0])
        }),
      )
      const byPower = powers.map((power) => landingFor({ errorMs: 20, power, heightError: 0 }, windows, 'right'))
      byPower
        .slice(1)
        .forEach((landing, step) => expect(landingScore(landing)).toBeGreaterThanOrEqual(landingScore(byPower[step])))
      expect(landingScore(byPower[byPower.length - 1])).toBeGreaterThan(landingScore(byPower[0]))
      const byHeight = steps(0, 0.45, 0.01).map((heightError) =>
        landingFor({ errorMs: 20, power: 1, heightError }, windows, 'right'),
      )
      byHeight
        .slice(1)
        .forEach((landing, step) => expect(landingScore(landing)).toBeLessThanOrEqual(landingScore(byHeight[step])))
      expect(landingScore(byHeight[byHeight.length - 1])).toBeLessThan(landingScore(byHeight[0]))
    })
  })
})
