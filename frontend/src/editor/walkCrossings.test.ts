import { describe, expect, it } from 'vitest'
import type { TownObject, TownObjectType, TownPoint } from '../data/models'
import { SAMPLE_TOWN } from '../testing/sampleTown'
import { getResidentWalk } from './townEditing'
import { getPetBlockedLegs, getResidentBlockedLegs } from './walkCrossings'

function placed(id: string, type: TownObjectType, x: number, z: number): TownObject {
  return { id, type, position: { x, y: 0, z }, rotation: 0, scale: 1 }
}

describe('blocked legs of a walk', () => {
  it('checks the way back to the first point and leaves out only the bench the resident sits on', () => {
    const objects = [
      placed('bench-own', 'bench', 0, 0),
      placed('bench-other', 'bench', 30, -2),
      placed('house', 'house', 20, 0),
    ]
    // From the bench stop the walk goes behind the own bench, east past the house, through the other bench, and back.
    const route: TownPoint[] = [
      [0, 0],
      [-0.75, -4],
      [30, -4],
      [30, 0],
    ]
    const resident = { ...SAMPLE_TOWN.residents[0], route, benchId: 'bench-own', seatIndex: 0 }
    const town = { ...SAMPLE_TOWN, objects, residents: [resident] }
    const walk = getResidentWalk(town, resident)
    expect(getResidentBlockedLegs(town, resident)).toEqual([
      [walk[2], walk[3]],
      [walk[3], walk[0]],
    ])
  })

  it('checks the default loop around the fountain while the pet has no walk of its own', () => {
    const objects = [placed('fountain', 'fountain', 0, 0), placed('house', 'house', -11, 0)]
    const town = { ...SAMPLE_TOWN, objects }
    expect(getPetBlockedLegs({ ...town, pet: { ...town.pet, route: null } })).toEqual([
      [
        [-4, 0],
        [-18, 0],
      ],
    ])
    const ownLoop: TownPoint[] = [
      [20, 20],
      [30, 20],
      [25, 30],
    ]
    expect(getPetBlockedLegs({ ...town, pet: { ...town.pet, route: ownLoop } })).toEqual([])
  })
})
