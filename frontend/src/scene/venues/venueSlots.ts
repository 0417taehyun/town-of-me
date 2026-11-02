import type { TownPoint } from '../../data/models'
import { DEFAULT_ROAD_COLOR, type TownRoad } from '../objects/roads/roadLayout'
import {
  DISTANT_HEDGE_COUNT,
  DISTANT_TREE_COUNT,
  forestTreePosition,
  hedgeBushPosition,
} from '../environment/distantWorldLayout'

// Where a large venue may stand at the town's edge, measured in the real town: the fog runs 68–145 m from the camera,
// the world bends away, and the follow camera looks north. A slot's frame has its origin at the gate's center on the
// hedge line and +z pointing into the town; a venue's exterior is drawn in it. The town's fence stays closed: a gate
// only opens the hedge, and the visitor enters by its prompt.

export type VenueSlotId = 'north'

export type VenueSlot = {
  /** The gate's center on the town's hedge line. */
  gate: TownPoint
  /** The frame's turn about +y, as a house's (`houseLocalPointToWorld`). */
  rotation: number
  /** The ground beyond the hedge the venue builds on: `width` across the gate and `depth` away from the town. */
  width: number
  depth: number
  /**
   * The ground inside the hedge that the venue's code owns, such as the ballpark's podium garden, as a rectangle in
   * the slot's frame. The editor outlines it and keeps placed objects out of it while the venue is shown.
   */
  approach: VenueApproach
}

export type VenueApproach = { minX: number; maxX: number; minZ: number; maxZ: number }

/** The opening a gate leaves in the hedge: the bushes centered in it go, and the gate's pillars stand at its sides. */
export const VENUE_GATE_WIDTH = 6.5

export const VENUE_SLOTS = {
  // At the end of the north road, ending before the forest's last ring and the hill behind it.
  // Its approach is the podium garden east of the north road, between the seed's trees at (8, −47) and (12, −33).
  north: {
    gate: [0, -53],
    rotation: 0,
    width: 70,
    depth: 36,
    approach: { minX: 2.8, maxX: 15.2, minZ: 6.4, maxZ: 18.4 },
  },
} satisfies Record<VenueSlotId, VenueSlot>

export function slotPointToWorld(slot: VenueSlot, [localX, localZ]: TownPoint): TownPoint {
  const cosine = Math.cos(slot.rotation)
  const sine = Math.sin(slot.rotation)
  return [slot.gate[0] + localX * cosine + localZ * sine, slot.gate[1] - localX * sine + localZ * cosine]
}

export function worldPointToSlot(slot: VenueSlot, [x, z]: TownPoint): TownPoint {
  const offsetX = x - slot.gate[0]
  const offsetZ = z - slot.gate[1]
  const cosine = Math.cos(slot.rotation)
  const sine = Math.sin(slot.rotation)
  return [offsetX * cosine - offsetZ * sine, offsetX * sine + offsetZ * cosine]
}

/** Where a visitor stands to go in: on the town's side of the gate, clear of the fence. */
export function venueEntrance(slot: VenueSlot) {
  return slotPointToWorld(slot, [0, 1.5])
}

/** Whether a point on the hedge line falls in the gate's opening. */
export function isInVenueGate(slot: VenueSlot, point: TownPoint) {
  const [x, z] = worldPointToSlot(slot, point)
  return Math.abs(x) < VENUE_GATE_WIDTH / 2 && Math.abs(z) < 1
}

export function isInsideVenueFootprint(slot: VenueSlot, point: TownPoint) {
  const [x, z] = worldPointToSlot(slot, point)
  return Math.abs(x) <= slot.width / 2 && z <= 0 && z >= -slot.depth
}

/** The hedge's bushes left standing once the gates of `openSlots` open. */
export function keptHedgeBushIndices(openSlots: readonly VenueSlot[]) {
  return Array.from({ length: DISTANT_HEDGE_COUNT }, (_, index) => index).filter(
    (index) => !openSlots.some((slot) => isInVenueGate(slot, hedgeBushPosition(index))),
  )
}

/** The forest's trees left standing once the venues of `openSlots` take their ground. */
export function keptForestTreeIndices(openSlots: readonly VenueSlot[]) {
  return Array.from({ length: DISTANT_TREE_COUNT }, (_, index) => index).filter(
    (index) => !openSlots.some((slot) => isInsideVenueFootprint(slot, forestTreePosition(index))),
  )
}

/** The town's road that ends at the slot's gate, if the admin kept one. */
export function gateRoad(roads: readonly TownRoad[], slot: VenueSlot) {
  const reachesGate = ([x, z]: TownPoint) => Math.hypot(x - slot.gate[0], z - slot.gate[1]) < VENUE_GATE_WIDTH
  return roads.find(({ points }) => reachesGate(points[0]) || reachesGate(points[points.length - 1]))
}

/** The color of the town's road that ends at the slot's gate, so the venue's forecourt carries it on. */
export function gateRoadColor(roads: readonly TownRoad[], slot: VenueSlot) {
  return gateRoad(roads, slot)?.color ?? DEFAULT_ROAD_COLOR
}

/** Whether a town point lies inside the slot's approach; its edge counts as outside. */
export function isInsideVenueApproach(slot: VenueSlot, point: TownPoint) {
  const [x, z] = worldPointToSlot(slot, point)
  const { minX, maxX, minZ, maxZ } = slot.approach
  return x > minX && x < maxX && z > minZ && z < maxZ
}

/** The nearest point on the approach's edge, straight out through its closest side. */
export function approachExit(slot: VenueSlot, point: TownPoint): TownPoint {
  const [x, z] = worldPointToSlot(slot, point)
  const { minX, maxX, minZ, maxZ } = slot.approach
  const exits: TownPoint[] = [
    [minX, z],
    [maxX, z],
    [x, minZ],
    [x, maxZ],
  ]
  const distance = ([exitX, exitZ]: TownPoint) => Math.abs(exitX - x) + Math.abs(exitZ - z)
  const nearest = exits.reduce((best, exit) => (distance(exit) < distance(best) ? exit : best))
  return slotPointToWorld(slot, nearest)
}

/** Moves a point inside any of the slots' approaches to the nearest point outside it; any other point stays. */
export function pushOutOfVenueApproach(slots: readonly VenueSlot[], point: TownPoint): TownPoint {
  return slots
    .filter((slot) => isInsideVenueApproach(slot, point))
    .reduce((pushed, slot) => approachExit(slot, pushed), point)
}

/** The approach's corners in the town, closed back to the first, for an outline. */
export function venueApproachOutline(slot: VenueSlot): TownPoint[] {
  const { minX, maxX, minZ, maxZ } = slot.approach
  const corners: TownPoint[] = [
    [minX, minZ],
    [maxX, minZ],
    [maxX, maxZ],
    [minX, maxZ],
    [minX, minZ],
  ]
  return corners.map((corner) => slotPointToWorld(slot, corner))
}
