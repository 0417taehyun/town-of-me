import { describe, expect, it } from 'vitest'
import { TOWN_OBJECT_VARIANTS, type TownObject, type TownObjectType } from '../../data/models'
import { HOUSE_MAILBOX_POSITION, houseLocalPointToWorld } from './houses/houseLayout'
import { getContactShadowLayout, getTownLayers, TOWN_OBJECT_KINDS } from './kinds'

const townObject = (id: string, type: TownObjectType, x: number, rotation = 0, scale = 1): TownObject => ({
  id,
  type,
  position: { x, y: 0, z: 2 },
  rotation,
  scale,
})

describe('town object kinds', () => {
  it('draws a layer shared by several kinds once, with all of their objects in town order', () => {
    const rock = townObject('rock', 'rock', 1)
    const bush = townObject('bush', 'bush', 2)
    const pumpkin = townObject('pumpkin', 'pumpkin', 3)
    const layers = getTownLayers([rock, townObject('tree', 'tree', 4), bush, pumpkin])
    const natureProps = layers.filter(({ Layer }) => Layer === TOWN_OBJECT_KINDS.rock.Layer)
    expect(natureProps).toHaveLength(1)
    expect(natureProps[0].objects).toEqual([rock, bush, pumpkin])
    expect(new Set(layers.map(({ Layer }) => Layer)).size).toBe(layers.length)
    expect(getTownLayers([])).toHaveLength(layers.length)
  })

  it('offers in the editor exactly the variants the town parser keeps', () => {
    Object.entries(TOWN_OBJECT_KINDS).forEach(([type, kind]) =>
      expect(kind.variants).toBe(TOWN_OBJECT_VARIANTS[type as TownObjectType]),
    )
  })

  it('lays a patch under each grounded object and house mailbox, turned and sized with it, and none under flat or airborne ones', () => {
    const layout = getContactShadowLayout([
      townObject('house', 'house', 10, 0.8),
      townObject('small-tree', 'tree', 20),
      townObject('big-tree', 'tree', 30, 0, 2),
      townObject('flower', 'flower', 40),
      townObject('bird', 'bird', 50),
    ])
    expect(layout).toHaveLength(4)
    const [house, mailbox, smallTree, bigTree] = layout
    expect(house).toMatchObject({ x: 10, z: 2, rotation: 0.8 })
    expect(house.width).toBeGreaterThan(house.depth)
    expect(house.depth).toBeGreaterThan(4.5)
    const [mailboxX, , mailboxZ] = houseLocalPointToWorld(townObject('house', 'house', 10, 0.8), HOUSE_MAILBOX_POSITION)
    expect(mailbox).toMatchObject({ x: mailboxX, z: mailboxZ, rotation: 0.8 })
    expect(mailbox.width).toBeLessThan(1.5)
    expect(smallTree.x).toBe(20)
    expect(bigTree.width).toBeCloseTo(smallTree.width * 2)
  })
})
