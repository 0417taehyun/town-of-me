import { itemAt } from './itemAt.js'
import { PITCH_TYPE_IDS, type PitchTypeId, type PlateTarget } from './pitch.js'

// Mirrors frontend/src/baseball/game/pitchSchedule.ts without the practice schedule, which is never scored.

export type ScheduledPitch = { type: PitchTypeId; target: PlateTarget }

/** Game pitches aim inside the strike zone with a margin: heights in this band, within `side` of the plate's middle. */
export const PITCH_TARGET_BAND = { low: 0.47, high: 0.73, side: 0.14 }

/**
 * `count` pitches (3 or more) with every type at least once, drawn in the client's order: the extra types, then the
 * shuffle, then each pitch's height and side.
 */
export function createPitchSchedule(random: () => number, count: number): ScheduledPitch[] {
  const extraTypes = Array.from({ length: count - PITCH_TYPE_IDS.length }, () => randomPitchType(random))
  const types = shuffled([...PITCH_TYPE_IDS, ...extraTypes], random)
  return types.map((type) => ({ type, target: randomTarget(random) }))
}

export function randomPitchType(random: () => number) {
  return itemAt(PITCH_TYPE_IDS, Math.floor(random() * PITCH_TYPE_IDS.length))
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
    ;[order[index], order[swap]] = [itemAt(order, swap), itemAt(order, index)]
  }
  return order
}
