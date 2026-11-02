import { describe, expect, it } from 'vitest'
import { DEFAULT_TOWN_VENUES, type TownVenues } from '../../data/models'
import {
  DISTANT_HEDGE_COUNT,
  DISTANT_TREE_COUNT,
  forestTreePosition,
  hedgeBushPosition,
} from '../environment/distantWorldLayout'
import { SAMPLE_TOWN } from '../../testing/sampleTown'
import { getTownRoads } from '../objects/roads/roadLayout'
import { getGroundRoads, getVenueCollision, getVenueEntrances, openVenueSlots } from './venuePlacements'
import {
  keptForestTreeIndices,
  keptHedgeBushIndices,
  pushOutOfVenueApproach,
  slotPointToWorld,
  VENUE_GATE_WIDTH,
  VENUE_SLOTS,
} from './venueSlots'

const shown: TownVenues = { ballpark: { ...DEFAULT_TOWN_VENUES.ballpark, visible: true } }

function removed(count: number, kept: number[]) {
  return Array.from({ length: count }, (_, index) => index).filter((index) => !kept.includes(index))
}

describe('venues at the town edge', () => {
  it('leaves the hedge closed, the forest whole, and no gate, garden, or branch path while the admin hides the ballpark', () => {
    const slots = openVenueSlots(DEFAULT_TOWN_VENUES)
    expect(keptHedgeBushIndices(slots)).toHaveLength(DISTANT_HEDGE_COUNT)
    expect(keptForestTreeIndices(slots)).toHaveLength(DISTANT_TREE_COUNT)
    expect(getVenueEntrances(DEFAULT_TOWN_VENUES, 'en')).toEqual([])
    expect(getGroundRoads(SAMPLE_TOWN.objects, DEFAULT_TOWN_VENUES)).toEqual(getTownRoads(SAMPLE_TOWN.objects))
    expect(getVenueCollision(DEFAULT_TOWN_VENUES)).toEqual({ boxes: [], circles: [] })
    expect(getGroundRoads(SAMPLE_TOWN.objects, shown)).toHaveLength(getTownRoads(SAMPLE_TOWN.objects).length + 1)
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

  it('moves a point inside a shown venue’s approach out through its nearest side and leaves any other point', () => {
    const slot = VENUE_SLOTS.north
    const { minX, maxX, minZ, maxZ } = slot.approach
    const middleZ = (minZ + maxZ) / 2
    const nearWest = slotPointToWorld(slot, [minX + 1, middleZ])
    const nearBack = slotPointToWorld(slot, [(minX + maxX) / 2, minZ + 0.5])
    const outside = slotPointToWorld(slot, [maxX + 0.1, minZ + 1])
    expect(pushOutOfVenueApproach([slot], nearWest)).toEqual(slotPointToWorld(slot, [minX, middleZ]))
    expect(pushOutOfVenueApproach([slot], nearBack)).toEqual(slotPointToWorld(slot, [(minX + maxX) / 2, minZ]))
    expect(pushOutOfVenueApproach([slot], outside)).toEqual(outside)
    expect(pushOutOfVenueApproach(openVenueSlots(DEFAULT_TOWN_VENUES), nearWest)).toEqual(nearWest)
  })
})
