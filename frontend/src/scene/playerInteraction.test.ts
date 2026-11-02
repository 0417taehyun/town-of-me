import { describe, expect, it } from 'vitest'
import { Vector3 } from 'three'
import type { BenchSeat } from './motion/characterPose'
import type { WorldActor } from './motion/npcMotion'
import { getNearbyInteraction } from './playerInteraction'
import { BASEBALL_PATH } from '../baseball/baseballRoute'
import { DEFAULT_TOWN_VENUES, type TownObject } from '../data/models'
import { getHouseApproachPosition } from './objects/houses/houseLayout'
import { createTownCollision, moveThroughTown } from './townCollision'
import { getVenueEntrances } from './venues/venuePlacements'

function actor(id: string, x: number, z: number, seatId?: string): WorldActor {
  return {
    id,
    name: id,
    kind: id === 'pet' ? 'dog' : 'resident',
    avatar: id[0],
    position: new Vector3(x, 1, z),
    radius: 0.5,
    interactionUntil: 0,
    pettingUntil: 0,
    seatId,
  }
}

const seats: BenchSeat[] = [
  { id: 'near', x: 1, z: 0, rotation: 0 },
  { id: 'far', x: 8, z: 0, rotation: 0 },
]
const labels = { guestbook: '방명록 보기', house: '문 열어보기', pet: 'Pet Robin' }

describe('nearby player interaction', () => {
  it('prioritizes the nearest actor over a bench', () => {
    const actors = [actor('maple', 2, 0), actor('pet', 1, 0)]
    const interaction = getNearbyInteraction(new Vector3(), { actors, seats, labels })
    expect(interaction).toMatchObject({ id: 'pet', kind: 'actor', label: 'Pet Robin' })
  })

  it('skips occupied seats and returns no distant target', () => {
    const occupied = getNearbyInteraction(new Vector3(), { actors: [actor('maple', 8, 0, 'near')], seats, labels })
    expect(occupied).toBeNull()
    expect(getNearbyInteraction(new Vector3(20, 0, 20), { actors: [], seats, labels })).toBeNull()
  })

  it('offers the closest available bench', () => {
    expect(getNearbyInteraction(new Vector3(), { actors: [], seats, labels })).toMatchObject({
      id: 'near',
      kind: 'bench',
    })
  })

  it('offers the guestbook when the visitor approaches the board', () => {
    const board = { x: 12, y: 0, z: -20 }
    const position = new Vector3(board.x, 0, board.z + 1)
    expect(getNearbyInteraction(position, { actors: [], seats: [], labels })).toBeNull()
    expect(getNearbyInteraction(position, { actors: [], seats: [], guestbookPosition: board, labels })).toMatchObject({
      id: 'town-guestbook',
      kind: 'guestbook',
      label: '방명록 보기',
    })
  })

  it('offers a localized unavailable door interaction at a house entrance', () => {
    const house: TownObject = {
      id: 'house-maple',
      type: 'house',
      position: { x: 12, y: 0, z: 8 },
      rotation: 0,
      scale: 1,
    }
    const [x, , z] = getHouseApproachPosition(house)

    expect(
      getNearbyInteraction(new Vector3(x, 0, z), { actors: [], seats: [], houses: [house], labels }),
    ).toMatchObject({
      id: 'door-house-maple',
      kind: 'house',
      label: '문 열어보기',
    })
  })

  it("offers a shown venue's gate to a visitor who walks up the north road into the fence, after a nearby resident", () => {
    const venueEntrances = getVenueEntrances({ ballpark: { ...DEFAULT_TOWN_VENUES.ballpark, visible: true } }, 'en')
    const options = { actors: [], seats: [], venueEntrances, labels }
    const walker = new Vector3(0, 0, -40)
    moveThroughTown(createTownCollision([]), [], walker, { x: 0, z: -6 }, 5)
    expect(walker.z).toBeGreaterThan(-53)

    expect(getNearbyInteraction(walker, options)).toMatchObject({ kind: 'venue', href: BASEBALL_PATH })
    const resident = actor('maple', walker.x + 1, walker.z)
    expect(getNearbyInteraction(walker, { ...options, actors: [resident] })).toMatchObject({ kind: 'actor' })
    expect(getNearbyInteraction(new Vector3(0, 0, -46), options)).toBeNull()
  })
})
