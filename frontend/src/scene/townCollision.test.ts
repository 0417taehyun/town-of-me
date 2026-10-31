import { describe, expect, it } from 'vitest'
import type { TownObject, TownObjectType } from '../data/models'
import { SAMPLE_TOWN } from '../testing/sampleTown'
import { getBenchPose, getBenchSeats } from './motion/characterPose'
import {
  createTownCollision,
  getObjectCollision,
  moveThroughTown,
  PLAYER_RADIUS,
  segmentTouchesBox,
  segmentTouchesCircle,
  segmentTouchesTown,
  type CollisionActor,
  type PlanarPoint,
  type TownCollision,
} from './townCollision'

function placed(type: TownObjectType, x: number, z: number, rotation = 0, extra: Partial<TownObject> = {}): TownObject {
  return { id: `${type}-${x}-${z}`, type, position: { x, y: 0, z }, rotation, scale: 1, ...extra }
}

function walk(
  town: TownCollision,
  from: PlanarPoint,
  velocity: PlanarPoint,
  seconds: number,
  actors: CollisionActor[] = [],
) {
  const position = { ...from }
  const remaining = { ...velocity }
  moveThroughTown(town, actors, position, remaining, seconds)
  return { position, velocity: remaining }
}

const countOf = (type: TownObjectType) => SAMPLE_TOWN.objects.filter((object) => object.type === type).length

describe('town collision layout', () => {
  it('gives every solid in the sample town its footprints and leaves bushes walkable', () => {
    const town = createTownCollision(SAMPLE_TOWN.objects)
    const footprintBoxes = 4 + 2 * countOf('house') + 2 * countOf('dogHouse') + 1 + 2 * countOf('bench')
    const solidProps = countOf('rock') + countOf('mushroom') + countOf('pumpkin')
    expect(countOf('bush')).toBeGreaterThan(0)
    expect(town.boxes).toHaveLength(footprintBoxes)
    expect(town.circles).toHaveLength(countOf('tree') + countOf('lamp') + 1 + solidProps)
  })

  it('leaves the spawn and every bench standing spot clear', () => {
    const town = createTownCollision(SAMPLE_TOWN.objects)
    const spots = [SAMPLE_TOWN.spawn, ...getBenchSeats(SAMPLE_TOWN.objects).map((seat) => getBenchPose(seat, false))]
    spots.forEach((spot) => {
      const { position } = walk(town, spot, { x: 0, z: 0 }, 1 / 60)
      expect(position.x).toBeCloseTo(spot.x)
      expect(position.z).toBeCloseTo(spot.z)
    })
  })
})

describe('moving through the town', () => {
  const openTown = createTownCollision([])

  it('moves freely and keeps its velocity in the open', () => {
    const { position, velocity } = walk(openTown, { x: 0, z: 0 }, { x: 1, z: -2 }, 1)
    expect(position).toEqual({ x: expect.closeTo(1), z: expect.closeTo(-2) })
    expect(velocity).toEqual({ x: 1, z: -2 })
  })

  it('stops against the town wall and loses the speed that pushed into it', () => {
    const { position, velocity } = walk(openTown, { x: 0, z: 50 }, { x: 0, z: 9.6 }, 1)
    expect(position.z).toBeCloseTo(52.4 - PLAYER_RADIUS)
    expect(position.x).toBeCloseTo(0)
    expect(velocity.z).toBeCloseTo(0)
  })

  it('slides along a wall at an angle, keeping the speed along it', () => {
    const { position, velocity } = walk(openTown, { x: 0, z: -51 }, { x: 3, z: -6 }, 1)
    expect(position.z).toBeCloseTo(-52.4 + PLAYER_RADIUS)
    expect(position.x).toBeCloseTo(3)
    expect(velocity).toEqual({ x: 3, z: expect.closeTo(0) })
  })

  it('turns a house with its rotation, mailbox included', () => {
    // Turned a quarter, the house faces +x and its mailbox stands at (13, 13.65).
    const town = createTownCollision([placed('house', 10, 10, Math.PI / 2)])
    expect(walk(town, { x: 16, z: 10 }, { x: -4, z: 0 }, 2).position.x).toBeCloseTo(10 + 2.35 + PLAYER_RADIUS)
    expect(walk(town, { x: 13, z: 20 }, { x: 0, z: -4 }, 3).position.z).toBeCloseTo(13.65 + 0.62 + PLAYER_RADIUS)
  })

  it('keeps a bench backrest behind the seat and never steps through it on a long frame', () => {
    const town = createTownCollision([placed('bench', 0, 0, Math.PI / 2, { seats: 2 })])
    const { position, velocity } = walk(town, { x: -3, z: 0 }, { x: 9.6, z: 0 }, 0.5)
    expect(position.x).toBeCloseTo(-0.57 - PLAYER_RADIUS)
    expect(velocity.x).toBeCloseTo(0)
  })

  it('pushes a body left inside a house out through the nearest wall', () => {
    const town = createTownCollision([placed('house', 0, 0)])
    const { position } = walk(town, { x: 0.5, z: 2 }, { x: 0, z: 0 }, 0)
    expect(position).toEqual({ x: 0.5, z: expect.closeTo(2.35 + PLAYER_RADIUS) })
  })

  it('slips around a tree trunk it meets off center while still pressing ahead', () => {
    const town = createTownCollision([placed('tree', 3, 0.3)])
    const position = { x: 0, z: 0 }
    for (let frame = 0; frame < 90; frame += 1) moveThroughTown(town, [], position, { x: 4.5, z: 0 }, 1 / 60)
    expect(position.x).toBeGreaterThan(4)
    expect(position.z).toBeLessThan(-0.3)
  })

  it('is blocked by residents and the pet wherever they are now', () => {
    const pet = { position: { x: 5, z: 0 }, radius: 0.82 }
    const { position, velocity } = walk(openTown, { x: 0, z: 0 }, { x: 4.5, z: 0 }, 2, [pet])
    expect(position.x).toBeCloseTo(5 - 0.82 - PLAYER_RADIUS)
    expect(velocity.x).toBeCloseTo(0)
  })
})

describe('a straight walk past solids', () => {
  const box = { x: 0, z: 0, halfWidth: 1, halfDepth: 0.5, cosine: 1, sine: 0 }

  it('touches a box it crosses between its ends or passes within its clearance, and not one it clears', () => {
    expect(segmentTouchesBox({ x: -5, z: 0.2 }, { x: 5, z: 0.2 }, box, 0.3)).toBe(true)
    expect(segmentTouchesBox({ x: -5, z: 0.75 }, { x: 5, z: 0.75 }, box, 0.3)).toBe(true)
    expect(segmentTouchesBox({ x: -5, z: 0.85 }, { x: 5, z: 0.85 }, box, 0.3)).toBe(false)
  })

  it('measures a walk past a corner from the rounded corner, not from the corner of a wider box', () => {
    // The corner is at (1, 0.5); walks along x + z = c pass it at |c - 1.5| / √2.
    expect(segmentTouchesBox({ x: 2.2, z: 0 }, { x: 0, z: 2.2 }, box, 0.5)).toBe(true)
    expect(segmentTouchesBox({ x: 2.4, z: 0 }, { x: 0, z: 2.4 }, box, 0.5)).toBe(false)
  })

  it('stops measuring a round solid at the ends of the walk', () => {
    const circle = { x: 0, z: 0, radius: 1 }
    expect(segmentTouchesCircle({ x: -5, z: 1.4 }, { x: 5, z: 1.4 }, circle, 0.5)).toBe(true)
    expect(segmentTouchesCircle({ x: -5, z: 0 }, { x: -1.6, z: 0 }, circle, 0.5)).toBe(false)
  })

  it('turns a house with its rotation and leaves the town fence out', () => {
    // Turned a quarter, the house reaches 2.35 east of its center instead of 2.8.
    const solids = getObjectCollision([placed('house', 0, 0, Math.PI / 2)])
    expect(segmentTouchesTown({ x: 2.6, z: -6 }, { x: 2.6, z: 2 }, solids, 0.2)).toBe(false)
    expect(segmentTouchesTown({ x: 2.5, z: -6 }, { x: 2.5, z: 2 }, solids, 0.2)).toBe(true)
    expect(segmentTouchesTown({ x: -50, z: 52 }, { x: -40, z: 52 }, solids, 0.5)).toBe(false)
  })
})
