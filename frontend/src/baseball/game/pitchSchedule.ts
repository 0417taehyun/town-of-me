import { STRIKE_ZONE } from './field'
import { PITCH_TYPE_IDS, type PitchTypeId, type PlateTarget } from './pitch'

export type ScheduledPitch = { type: PitchTypeId; target: PlateTarget }

/** Game pitches aim inside the strike zone with a margin: heights in this band, within `side` of the plate's middle. */
export const PITCH_TARGET_BAND = { low: 0.47, high: 0.73, side: 0.14 }

/**
 * Practice measures the visitor's timing on every pitch type, so it throws each one at the zone's center in an order
 * that never changes.
 */
export const PRACTICE_SCHEDULE: readonly ScheduledPitch[] = (
  ['fastball', 'changeup', 'curve', 'fastball', 'curve'] as const
).map((type) => ({ type, target: { x: 0, y: STRIKE_ZONE.center } }))

/**
 * More practice after too few swings counted: one pitch of each type. With the valid swings kept from before, fewer
 * than a calibration needs, it stays within the practice samples the board takes (backend/src/homeRunDerby.ts).
 */
export const MORE_PRACTICE_SCHEDULE: readonly ScheduledPitch[] = PRACTICE_SCHEDULE.slice(0, 3)

/**
 * `count` pitches (3 or more) with every type at least once. A server replaying the run must draw in the same order:
 * the extra types, then the shuffle, then each pitch's height and side.
 */
export function createPitchSchedule(random: () => number, count: number): ScheduledPitch[] {
  const extraTypes = Array.from({ length: count - PITCH_TYPE_IDS.length }, () => randomPitchType(random))
  const types = shuffled([...PITCH_TYPE_IDS, ...extraTypes], random)
  return types.map((type) => ({ type, target: randomTarget(random) }))
}

export function randomPitchType(random: () => number) {
  return PITCH_TYPE_IDS[Math.floor(random() * PITCH_TYPE_IDS.length)]
}

export function randomTarget(random: () => number): PlateTarget {
  const height = PITCH_TARGET_BAND.low + (PITCH_TARGET_BAND.high - PITCH_TARGET_BAND.low) * random()
  const side = PITCH_TARGET_BAND.side * (2 * random() - 1)
  return { x: side, y: height }
}

/** Fisher-Yates: every order equally likely. */
export function shuffled<Item>(items: Item[], random: () => number) {
  const order = [...items]
  for (let index = order.length - 1; index > 0; index -= 1) {
    const swap = Math.floor(random() * (index + 1))
    ;[order[index], order[swap]] = [order[swap], order[index]]
  }
  return order
}
