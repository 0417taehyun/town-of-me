import { describe, expect, it } from 'vitest'
import { DIFFICULTY_RULES } from './difficulty'
import { FOUL_ANGLE } from './field'
import { judgeTiming, swingPower, SWING_POWER_RANGE, type TimingId } from './judging'
import { landingFor, type Landing } from './landing'

const timingRank: Record<TimingId, number> = { tooEarly: 0, tooLate: 0, early: 1, late: 1, good: 2, perfect: 3 }
const outcomeRank: Record<Landing['outcome'], number> = { miss: 0, foul: 1, hit: 2, homeRun: 3 }
const difficulties = Object.values(DIFFICULTY_RULES)
/** A level bat sends every GOOD swing out of the park; a lost one carries shorter, so some land as hits. */
const batHeights = [0, null]

function landingOn(difficulty: keyof typeof DIFFICULTY_RULES, errorMs: number, heightError: number | null) {
  return landingFor({ errorMs, power: 1, heightError }, DIFFICULTY_RULES[difficulty].timingWindows, 'right')
}

/** One number that orders landings: the outcome first, then the distance. */
function landingScore(landing: Landing) {
  return outcomeRank[landing.outcome] * 100000 + landing.distanceDecimetres
}

describe('swing judging', () => {
  it('never judges the same timing error better on hard than on normal, or on normal than on easy', () => {
    // Every 5 ms out to 250 either way, and either side of each window's edges, where a judgement changes.
    const edges = difficulties.flatMap(({ timingWindows }) => Object.values(timingWindows))
    const errors = [
      ...Array.from({ length: 101 }, (_, step) => step * 5 - 250),
      ...edges.flatMap((edge) => [edge, edge + 1, -edge, -edge - 1]),
    ]
    errors.forEach((errorMs) => {
      const [easy, normal, hard] = difficulties.map(
        ({ timingWindows }) => timingRank[judgeTiming(errorMs, timingWindows)],
      )
      expect(hard).toBeLessThanOrEqual(normal)
      expect(normal).toBeLessThanOrEqual(easy)
      batHeights.forEach((heightError) => {
        const [easyLanding, normalLanding, hardLanding] = (['easy', 'normal', 'hard'] as const).map((difficulty) =>
          landingScore(landingOn(difficulty, errorMs, heightError)),
        )
        expect(hardLanding).toBeLessThanOrEqual(normalLanding)
        expect(normalLanding).toBeLessThanOrEqual(easyLanding)
      })
    })
  })

  it('pulls an early swing toward one line and pushes a late one toward the other, foul past the GOOD window', () => {
    difficulties.forEach(({ timingWindows }) => {
      const swing = (errorMs: number) => ({ errorMs, power: 1, heightError: 0 })
      const fairlyEarly = landingFor(swing(-timingWindows.perfect), timingWindows, 'right')
      expect(fairlyEarly.outcome).not.toBe('foul')
      expect(fairlyEarly.spray).toBeLessThan(0)
      expect(landingFor(swing(timingWindows.perfect), timingWindows, 'right').spray).toBeGreaterThan(0)
      expect(landingFor(swing(-timingWindows.perfect), timingWindows, 'left').spray).toBeGreaterThan(0)
      expect(landingFor(swing(timingWindows.perfect), timingWindows, 'left').spray).toBeLessThan(0)
      const offBy = (timingWindows.good + timingWindows.contact) / 2
      const pulled = landingFor(swing(-offBy), timingWindows, 'right')
      const pushed = landingFor(swing(offBy), timingWindows, 'right')
      expect([pulled.outcome, pushed.outcome]).toEqual(['foul', 'foul'])
      expect(pulled.spray).toBeLessThan(-FOUL_ANGLE)
      expect(pushed.spray).toBeGreaterThan(FOUL_ANGLE)
      expect(landingFor(swing(-offBy), timingWindows, 'left').spray).toBeGreaterThan(FOUL_ANGLE)
    })
  })

  it('misses a swing outside the contact window, early or late', () => {
    difficulties.forEach(({ timingWindows }) => {
      const outside = timingWindows.contact + 1
      expect(judgeTiming(-outside, timingWindows)).toBe('tooEarly')
      expect(judgeTiming(outside, timingWindows)).toBe('tooLate')
      const swings = [-outside, outside].map((errorMs) => ({ errorMs, power: 1.15, heightError: 0 }))
      swings.forEach((swing) => expect(landingFor(swing, timingWindows, 'right').outcome).toBe('miss'))
    })
  })

  it('turns a big height error on a perfect swing into a hit, a bigger one into a miss, and an unknown one into neither', () => {
    const windows = DIFFICULTY_RULES.normal.timingWindows
    const perfect = (heightError: number | null) =>
      landingFor({ errorMs: 0, power: 1.15, heightError }, windows, 'right')
    expect(perfect(0).outcome).toBe('homeRun')
    expect([perfect(0.4).outcome, perfect(-0.4).outcome]).toEqual(['hit', 'hit'])
    expect([perfect(0.5).outcome, perfect(-0.5).outcome]).toEqual(['miss', 'miss'])
    expect(perfect(null).outcome).toBe('homeRun')
  })

  it('measures camera power against the practice peak, within its range', () => {
    expect(swingPower(8, 8)).toBe(1)
    expect(swingPower(6, 8)).toBe(0.75)
    expect(swingPower(80, 8)).toBe(SWING_POWER_RANGE.maximum)
    expect(swingPower(0, 8)).toBe(SWING_POWER_RANGE.minimum)
  })
})
