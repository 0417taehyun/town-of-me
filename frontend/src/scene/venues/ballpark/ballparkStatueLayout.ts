import type { TownPoint } from '../../../data/models'
import { nearestPointOnRoad, type TownRoad } from '../../objects/roads/roadLayout'
import type { StatueSpot } from '../../playerInteraction'
import type { StatueRank } from '../../statues/statueFinishes'
import type { CollisionBox, CollisionCircle, TownCollision } from '../../townCollision'
import { gateRoad, gateRoadColor, slotPointToWorld, type VenueSlot } from '../venueSlots'

// The ballpark's podium garden inside the town's hedge, east of the north road (town-statues layout C): the board's
// 2-1-3 stage before an arc of hedge with bunting and flower beds, two lamps, and a sign, reached by a short branch
// path that leaves the road toward the gate. It is code-owned, like the gate: it stands in the slot's approach, which
// the editor keeps clear, and only while the ballpark is shown. Measured in the garden's own frame: its centre at the
// origin and its front, toward the road back to town, along +z.

/** The town's statues stand 1.3 times the board's, so a figure is a little taller than a townsperson. */
export const STATUE_SCALE = 1.3

export type PodiumSpot = { rank: StatueRank; x: number; z: number; turn: number }

export type PodiumGarden = {
  /** The garden's centre in the slot's frame, and its turn about +y. */
  at: TownPoint
  turn: number
  /** The low stage: its half widths across and front to back, how far forward of the centre, and its height. */
  stage: { radiusX: number; radiusZ: number; z: number; height: number }
  /** Each place's pedestal on the stage, read 2-1-3 from the visitor's left as on the board. */
  spots: readonly PodiumSpot[]
  /** The centre, in front of the stage, that the hedge and the flower beds curve round behind it. */
  arcCenterZ: number
  /**
   * The hedge's arc: its radius, its tube's radius and how much taller than wide it stands, its middle's height, and
   * the angles it sweeps (`arcPoint`).
   */
  hedge: { radius: number; tube: number; stretch: number; y: number; from: number; sweep: number }
  /** The flower beds along the hedge's foot, between two radii, a little round the hedge's ends. */
  beds: { inner: number; outer: number; count: number; from: number; sweep: number }
  /** The bunting's two posts, `halfWidth` either side behind the stage, its string's height at them, and its sag. */
  bunting: { halfWidth: number; z: number; height: number; sag: number }
  lamps: readonly TownPoint[]
  sign: { x: number; z: number; turn: number; height: number }
  /**
   * Where a visitor stands to read a statue's card: `z` in front of the centre, on the branch's pad, and `spread` of the
   * way out toward the statue, so the nearest card is the statue straight ahead.
   */
  card: { z: number; spread: number }
  /**
   * The branch path, a town road in the north road's color: it leaves that road at `start` (slot frame, moved onto
   * the road's middle), bends at `bend` (slot frame), and ends at `end` (garden frame), whose round pad is the
   * stage's forecourt. Its inner corners round to `rounding`.
   */
  branch: { width: number; rounding: number; start: TownPoint; bend: TownPoint; end: TownPoint }
}

export const BALLPARK_GARDEN: PodiumGarden = {
  // Faces the north road a little short of the fork, so it greets the visitor walking up to the gate.
  at: [9, 12],
  turn: -0.86,
  stage: { radiusX: 3.9, radiusZ: 1.75, z: 0.1, height: 0.12 },
  spots: [
    { rank: 2, x: -2.35, z: 0.15, turn: 0.17 },
    { rank: 1, x: 0, z: -0.2, turn: 0 },
    { rank: 3, x: 2.35, z: 0.15, turn: -0.17 },
  ],
  arcCenterZ: 3.1,
  hedge: { radius: 5.2, tube: 0.62, stretch: 1.9, y: 0.9, from: Math.PI * 1.19, sweep: Math.PI * 0.62 },
  beds: { inner: 4.4, outer: 4.85, count: 34, from: Math.PI * 1.12, sweep: Math.PI * 0.76 },
  bunting: { halfWidth: 4.3, z: -1.55, height: 3.15, sag: 0.75 },
  lamps: [
    [-4.7, -0.6],
    [4.7, -0.6],
  ],
  sign: { x: 5.1, z: 1.7, turn: -0.25, height: 1.3 },
  card: { z: 2.9, spread: 0.8 },
  // Forks forward, the way a visitor walking to the gate veers right, then bends into the pad before the stage.
  branch: { width: 3.8, rounding: 2.6, start: [-0.55, 19.5], bend: [1.63, 16.4], end: [0, 3] },
}

/** A point in the garden's frame, in the slot's. */
export function gardenPointToSlot(garden: PodiumGarden, [x, z]: TownPoint): TownPoint {
  const cosine = Math.cos(garden.turn)
  const sine = Math.sin(garden.turn)
  return [garden.at[0] + x * cosine + z * sine, garden.at[1] - x * sine + z * cosine]
}

/** A point `radius` from the centre the hedge curves round, at `angle` from +x toward +z (the back is −z). */
export function arcPoint(garden: PodiumGarden, angle: number, radius: number): TownPoint {
  return [Math.cos(angle) * radius, garden.arcCenterZ + Math.sin(angle) * radius]
}

/**
 * The stage as circles inside its ellipse, so the visitor's body stops at about its edge and walks round the pedestals
 * instead of over them. Each circle's radius is the ellipse's half depth at its centre or its distance to the tip.
 */
export function stageColliders(garden: PodiumGarden): CollisionCircle[] {
  const { radiusX, radiusZ, z } = garden.stage
  return [-3.1, -1.9, 0, 1.9, 3.1].map((x) => {
    const halfDepth = radiusZ * Math.sqrt(1 - (x / radiusX) ** 2)
    const [centerX, centerZ] = gardenPointToSlot(garden, [x, z])
    return { x: centerX, z: centerZ, radius: Math.min(halfDepth, radiusX - Math.abs(x)) * 0.97 }
  })
}

/** The flower beds and the hedge behind them as overlapping circles, too close for the visitor to slip between. */
export function hedgeColliders(garden: PodiumGarden): CollisionCircle[] {
  const { inner, from, sweep } = garden.beds
  const outer = garden.hedge.radius + garden.hedge.tube
  return Array.from({ length: 11 }, (_, index) => {
    const [x, z] = gardenPointToSlot(garden, arcPoint(garden, from + (sweep * index) / 10, (inner + outer) / 2))
    return { x, z, radius: (outer - inner) / 2 }
  })
}

/** Everything solid in the garden, in the slot's frame: the stage, the hedge, the lamp and bunting posts, the sign. */
export function podiumGardenSolids(garden: PodiumGarden): TownCollision {
  const buntingPosts = [-1, 1].map((side): TownPoint => [side * garden.bunting.halfWidth, garden.bunting.z])
  const posts = [
    ...garden.lamps.map((lamp) => ({ point: lamp, radius: 0.18 })),
    ...buntingPosts.map((post) => ({ point: post, radius: 0.1 })),
  ].map(({ point, radius }): CollisionCircle => {
    const [x, z] = gardenPointToSlot(garden, point)
    return { x, z, radius }
  })
  const [signX, signZ] = gardenPointToSlot(garden, [garden.sign.x, garden.sign.z])
  const signTurn = garden.turn + garden.sign.turn
  const sign: CollisionBox = {
    x: signX,
    z: signZ,
    halfWidth: 0.95,
    halfDepth: 0.12,
    cosine: Math.cos(signTurn),
    sine: Math.sin(signTurn),
  }
  return { boxes: [sign], circles: [...stageColliders(garden), ...hedgeColliders(garden), ...posts] }
}

/** The garden's solids in the town. */
export function podiumGardenCollision(garden: PodiumGarden, slot: VenueSlot): TownCollision {
  const solids = podiumGardenSolids(garden)
  const toWorld = ({ x, z }: { x: number; z: number }) => {
    const [worldX, worldZ] = slotPointToWorld(slot, [x, z])
    return { x: worldX, z: worldZ }
  }
  const slotCosine = Math.cos(slot.rotation)
  const slotSine = Math.sin(slot.rotation)
  return {
    circles: solids.circles.map((circle) => ({ ...circle, ...toWorld(circle) })),
    boxes: solids.boxes.map((box) => ({
      ...box,
      ...toWorld(box),
      cosine: box.cosine * slotCosine - box.sine * slotSine,
      sine: box.sine * slotCosine + box.cosine * slotSine,
    })),
  }
}

/** Where each statue's card opens in the town, and the statue the camera frames with the visitor there. */
export function podiumCardSpots(garden: PodiumGarden, slot: VenueSlot): StatueSpot[] {
  const toWorld = (point: TownPoint) => slotPointToWorld(slot, gardenPointToSlot(garden, point))
  return garden.spots.map((spot) => {
    const [x, z] = toWorld([spot.x * garden.card.spread, garden.card.z])
    const [statueX, statueZ] = toWorld([spot.x, spot.z])
    return { rank: spot.rank, x, z, statue: { x: statueX, z: statueZ } }
  })
}

/** The branch path in the town, leaving the middle of the road that reaches the gate, in that road's color. */
export function podiumGardenBranch(garden: PodiumGarden, slot: VenueSlot, roads: readonly TownRoad[]): TownRoad {
  const { width, rounding, start, bend, end } = garden.branch
  const designed = slotPointToWorld(slot, start)
  const road = gateRoad(roads, slot)
  return {
    id: 'venue-podium-branch',
    color: gateRoadColor(roads, slot),
    width,
    rounding,
    points: [
      road ? nearestPointOnRoad(road, designed) : designed,
      slotPointToWorld(slot, bend),
      slotPointToWorld(slot, gardenPointToSlot(garden, end)),
    ],
  }
}
