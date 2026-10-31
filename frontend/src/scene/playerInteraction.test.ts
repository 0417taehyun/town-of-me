import { describe, expect, it } from 'vitest'
import { Vector3 } from 'three'
import type { BenchSeat } from './motion/characterPose'
import type { WorldActor } from './motion/npcMotion'
import { getNearbyInteraction } from './playerInteraction'
import type { TownObject } from '../data/models'
import { getHouseApproachPosition } from './objects/houses/houseLayout'

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

describe('nearby player interaction', () => {
  it('prioritizes the nearest actor over a bench', () => {
    const actors = [actor('maple', 2, 0), actor('pet', 1, 0)]
    const interaction = getNearbyInteraction(new Vector3(), actors, seats, 'Read', [], 'Door', null, 'Pet Robin')
    expect(interaction).toMatchObject({ id: 'pet', kind: 'actor', label: 'Pet Robin' })
  })

  it('skips occupied seats and returns no distant target', () => {
    const occupied = getNearbyInteraction(new Vector3(), [actor('maple', 8, 0, 'near')], seats)
    expect(occupied).toBeNull()
    expect(getNearbyInteraction(new Vector3(20, 0, 20), [], seats)).toBeNull()
  })

  it('offers the closest available bench', () => {
    expect(getNearbyInteraction(new Vector3(), [], seats)).toMatchObject({ id: 'near', kind: 'bench' })
  })

  it('offers the guestbook when the visitor approaches the board', () => {
    const board = { x: 12, y: 0, z: -20 }
    const position = new Vector3(board.x, 0, board.z + 1)
    expect(getNearbyInteraction(position, [], [], '방명록 보기')).toBeNull()
    expect(getNearbyInteraction(position, [], [], '방명록 보기', [], '문 열어보기', board)).toMatchObject({
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

    expect(getNearbyInteraction(new Vector3(x, 0, z), [], [], '방명록 보기', [house], '문 열어보기')).toMatchObject({
      id: 'door-house-maple',
      kind: 'house',
      label: '문 열어보기',
    })
  })
})
