import { describe, expect, it } from 'vitest'
import { DEFAULT_TOWN_VENUES, type TownVenues } from '../../data/models'
import {
  DISTANT_HEDGE_COUNT,
  DISTANT_TREE_COUNT,
  forestTreePosition,
  hedgeBushPosition,
} from '../environment/distantWorldLayout'
import { getVenueEntrances, openVenueSlots } from './venuePlacements'
import { keptForestTreeIndices, keptHedgeBushIndices, VENUE_GATE_WIDTH, VENUE_SLOTS } from './venueSlots'

const shown: TownVenues = { ballpark: { ...DEFAULT_TOWN_VENUES.ballpark, visible: true } }

function removed(count: number, kept: number[]) {
  return Array.from({ length: count }, (_, index) => index).filter((index) => !kept.includes(index))
}

describe('venues at the town edge', () => {
  it('leaves the hedge closed and the forest whole, with no gate to enter, while the admin hides the ballpark', () => {
    const slots = openVenueSlots(DEFAULT_TOWN_VENUES)
    expect(keptHedgeBushIndices(slots)).toHaveLength(DISTANT_HEDGE_COUNT)
    expect(keptForestTreeIndices(slots)).toHaveLength(DISTANT_TREE_COUNT)
    expect(getVenueEntrances(DEFAULT_TOWN_VENUES, 'en')).toEqual([])
  })

  it('opens the hedge only in the gate and clears the forest only on the ground behind it once shown', () => {
    const slots = openVenueSlots(shown)
    const { gate, width, depth } = VENUE_SLOTS.north
    expect(slots).toEqual([VENUE_SLOTS.north])
    const bushes = removed(DISTANT_HEDGE_COUNT, keptHedgeBushIndices(slots)).map(hedgeBushPosition)
    expect(bushes.length).toBeGreaterThan(0)
    bushes.forEach(([x, z]) => {
      expect(Math.abs(x - gate[0])).toBeLessThan(VENUE_GATE_WIDTH / 2)
      expect(Math.abs(z - gate[1])).toBeLessThan(1)
    })
    const trees = removed(DISTANT_TREE_COUNT, keptForestTreeIndices(slots)).map(forestTreePosition)
    expect(trees.length).toBeGreaterThan(0)
    trees.forEach(([x, z]) => {
      expect(Math.abs(x - gate[0])).toBeLessThanOrEqual(width / 2)
      expect(z).toBeLessThan(gate[1])
      expect(z).toBeGreaterThanOrEqual(gate[1] - depth)
    })
  })
})
