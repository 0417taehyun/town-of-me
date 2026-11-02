import { describe, expect, it } from 'vitest'
import { DEFAULT_TOWN_VENUES, type TownPoint, type TownVenues } from '../../../data/models'
import { SAMPLE_TOWN } from '../../../testing/sampleTown'
import { getTownRoads, paintedRoadPath } from '../../objects/roads/roadLayout'
import { PEDESTAL } from '../../statues/statueFinishes'
import { createTownCollision, PLAYER_RADIUS, segmentTouchesTown } from '../../townCollision'
import { getVenueCollision } from '../venuePlacements'
import { gateRoad, isInsideVenueApproach, slotPointToWorld, venueEntrance, VENUE_SLOTS } from '../venueSlots'
import {
  BALLPARK_GARDEN,
  gardenPointToSlot,
  podiumGardenBranch,
  podiumGardenCollision,
  STATUE_SCALE,
} from './ballparkStatueLayout'

const slot = VENUE_SLOTS.north
const garden = BALLPARK_GARDEN
const shown: TownVenues = { ballpark: { ...DEFAULT_TOWN_VENUES.ballpark, visible: true } }

/** The four points where a circle reaches furthest along the town's axes. */
function reach(x: number, z: number, radius: number): TownPoint[] {
  return [
    [x - radius, z],
    [x + radius, z],
    [x, z - radius],
    [x, z + radius],
  ]
}

function walkTouches(path: readonly TownPoint[], venues: TownVenues) {
  const town = createTownCollision(SAMPLE_TOWN.objects, getVenueCollision(venues))
  return path
    .slice(1)
    .filter(([x, z], index) =>
      segmentTouchesTown({ x: path[index][0], z: path[index][1] }, { x, z }, town, PLAYER_RADIUS),
    )
}

describe('the ballpark’s podium garden', () => {
  it('keeps its pedestals, solids, and the branch’s end pad inside the approach the editor keeps clear', () => {
    const solids = podiumGardenCollision(garden, slot)
    const pedestals = garden.spots.map((spot) => {
      const [x, z] = slotPointToWorld(slot, gardenPointToSlot(garden, [spot.x, spot.z]))
      return reach(x, z, PEDESTAL.plinthRadius * STATUE_SCALE)
    })
    const boxCorners = solids.boxes.flatMap((box) =>
      [-1, 1].flatMap((sideX) =>
        [-1, 1].map((sideZ): TownPoint => {
          const x = sideX * box.halfWidth
          const z = sideZ * box.halfDepth
          return [box.x + x * box.cosine + z * box.sine, box.z - x * box.sine + z * box.cosine]
        }),
      ),
    )
    const branch = podiumGardenBranch(garden, slot, getTownRoads(SAMPLE_TOWN.objects))
    const [endX, endZ] = branch.points[branch.points.length - 1]
    const points = [
      ...pedestals.flat(),
      ...solids.circles.flatMap(({ x, z, radius }) => reach(x, z, radius)),
      ...boxCorners,
      ...reach(endX, endZ, branch.width * 0.76),
    ]
    expect(points.filter((point) => !isInsideVenueApproach(slot, point))).toEqual([])
  })

  it('leaves the north road open up to the gate and the branch open to the stage once the garden stands', () => {
    const roads = getTownRoads(SAMPLE_TOWN.objects)
    const northRoad = paintedRoadPath(gateRoad(roads, slot)!.points)
    const [, entranceZ] = venueEntrance(slot)
    const toGate = northRoad.filter(([, z]) => z <= -28 && z >= entranceZ)
    const branch = paintedRoadPath(podiumGardenBranch(garden, slot, roads).points)
    expect(toGate.length).toBeGreaterThan(10)
    expect(walkTouches(toGate, shown)).toEqual([])
    expect(walkTouches(branch, shown)).toEqual([])
  })
})
