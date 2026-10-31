import { describe, expect, it } from 'vitest'
import { PITCH_COUNT_RANGE } from '../../data/models'
import { PITCH_TYPE_IDS } from './pitch'
import { createPitchSchedule, PITCH_TARGET_BAND, PRACTICE_SCHEDULE } from './pitchSchedule'
import { createSeededRandom } from './seededRandom'

const seeds = Array.from({ length: 200 }, (_, index) => index * 7919 + 13)
const counts = Array.from(
  { length: PITCH_COUNT_RANGE.maximum - PITCH_COUNT_RANGE.minimum + 1 },
  (_, index) => PITCH_COUNT_RANGE.minimum + index,
)

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
})
