import { describe, expect, it } from 'vitest'
import { PITCH_COUNT_RANGE, type Vec3 } from '../../data/models'
import { DIFFICULTY_RULES, PRACTICE_PITCH_FLIGHT_SECONDS } from './difficulty'
import { BALL_RADIUS, BATTER_REACH, STRIKE_ZONE } from './field'
import { contactSeconds, PITCH_TYPE_IDS, type PitchPlan, pitchPosition, planPitch, secondsAtDepth } from './pitch'
import {
  createPitchSchedule,
  PITCH_TARGET_BAND,
  PRACTICE_SCHEDULE,
  randomTarget,
  type ScheduledPitch,
} from './pitchSchedule'
import { createSeededRandom } from './seededRandom'

const seeds = Array.from({ length: 20 }, (_, index) => index * 7919 + 13)
const counts = Array.from(
  { length: PITCH_COUNT_RANGE.maximum - PITCH_COUNT_RANGE.minimum + 1 },
  (_, index) => PITCH_COUNT_RANGE.minimum + index,
)

/** How far (m) the whole ball centred at `position` is inside the strike zone over the plate; negative is outside. */
function zoneMargin({ x, y }: Vec3) {
  const { bottom, top, halfWidth } = STRIKE_ZONE
  return Math.min(halfWidth - Math.abs(x), y - bottom, top - y) - BALL_RADIUS
}

/** A random source that hands out `draws` in order, so randomTarget can be driven to the band's corners and edges. */
function drawing(draws: number[]) {
  const queue = [...draws]
  return () => queue.shift() ?? 0
}

type ThrownPitch = ScheduledPitch & { pace: number; plan: PitchPlan }

function thrown(pitches: readonly ScheduledPitch[], paces: readonly number[]): ThrownPitch[] {
  return paces.flatMap((pace) =>
    pitches.map((pitch) => ({ ...pitch, pace, plan: planPitch(pitch.type, pace, pitch.target) })),
  )
}

/** The pitches among `pitches` whose whole ball misses the zone by less than `margin` at a depth `depthsOf` gives. */
function balls(pitches: ThrownPitch[], depthsOf: (plan: PitchPlan) => number[], margin: number) {
  return pitches
    .filter(({ plan }) => depthsOf(plan).some((seconds) => zoneMargin(pitchPosition(plan, seconds)) < margin))
    .map(({ type, target, pace }) => `${type} at (${target.x}, ${target.y}) over ${pace} s`)
}

const gamePaces = Object.values(DIFFICULTY_RULES).map((rule) => rule.pitchFlightSeconds)
// Draws from 0 to the limit of 1 take randomTarget to every corner and edge of the band, and across its middle, where
// any schedule's targets lie (the first test), so every type at each of them, at every pace, bounds every pitch.
const draws = [0, 0.25, 0.5, 0.75, 1]
const bandTargets = draws.flatMap((height) => draws.map((side) => randomTarget(drawing([height, side]))))
const everyPitch = [
  ...thrown(PRACTICE_SCHEDULE, [PRACTICE_PITCH_FLIGHT_SECONDS]),
  ...thrown(
    PITCH_TYPE_IDS.flatMap((type) => bandTargets.map((target) => ({ type, target }))),
    gamePaces,
  ),
]

describe('pitch schedule', () => {
  it('throws every pitch type at least once at every pitch count, aiming inside the target band', () => {
    counts.forEach((count) =>
      seeds.forEach((seed) => {
        const schedule = createPitchSchedule(createSeededRandom(seed), count)
        expect(schedule).toHaveLength(count)
        expect(new Set(schedule.map((pitch) => pitch.type))).toEqual(new Set(PITCH_TYPE_IDS))
        schedule.forEach(({ target }) => {
          expect(target.y).toBeGreaterThanOrEqual(PITCH_TARGET_BAND.low)
          expect(target.y).toBeLessThan(PITCH_TARGET_BAND.high)
          expect(Math.abs(target.x)).toBeLessThanOrEqual(PITCH_TARGET_BAND.side)
        })
      }),
    )
    expect(new Set(PRACTICE_SCHEDULE.map((pitch) => pitch.type))).toEqual(new Set(PITCH_TYPE_IDS))
  })

  it('fills the pitches past the first three with every type', () => {
    const extras = seeds.flatMap((seed) => createPitchSchedule(createSeededRandom(seed), PITCH_COUNT_RANGE.maximum))
    PITCH_TYPE_IDS.forEach((type) =>
      expect(extras.filter((pitch) => pitch.type === type).length).toBeGreaterThan(seeds.length * 2),
    )
  })

  it('repeats a run exactly from its seed, while different seeds open with every type', () => {
    seeds.forEach((seed) =>
      expect(createPitchSchedule(createSeededRandom(seed), 7)).toEqual(
        createPitchSchedule(createSeededRandom(seed), 7),
      ),
    )
    const openers = seeds.map(
      (seed) => createPitchSchedule(createSeededRandom(seed), PITCH_COUNT_RANGE.minimum)[0].type,
    )
    expect(new Set(openers)).toEqual(new Set(PITCH_TYPE_IDS))
  })

  it('throws only strikes: the whole ball crosses the front of the plate inside the zone, with room to spare', () => {
    expect(bandTargets).toContainEqual({ x: PITCH_TARGET_BAND.side, y: PITCH_TARGET_BAND.high })
    expect(bandTargets).toContainEqual({ x: -PITCH_TARGET_BAND.side, y: PITCH_TARGET_BAND.low })
    const plateFront = (plan: PitchPlan) => [secondsAtDepth(plan, STRIKE_ZONE.halfWidth)]
    expect(balls(everyPitch, plateFront, 0.02)).toEqual([])
  })

  it('keeps every pitch inside the zone from where the bat meets it to where it waits for a late swing', () => {
    const stretch = (plan: PitchPlan) => {
      const from = contactSeconds(plan)
      const to = secondsAtDepth(plan, BATTER_REACH.back)
      return Array.from({ length: 21 }, (_, step) => from + ((to - from) * step) / 20)
    }
    expect(balls(everyPitch, stretch, 0)).toEqual([])
  })
})
