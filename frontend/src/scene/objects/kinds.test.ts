import { describe, expect, it } from 'vitest'
import { TOWN_OBJECT_VARIANTS, type TownObject, type TownObjectType } from '../../data/models'
import { getTownLayers, TOWN_OBJECT_KINDS } from './kinds'

const townObject = (id: string, type: TownObjectType, x: number): TownObject => ({
  id,
  type,
  position: { x, y: 0, z: 2 },
  rotation: 0,
  scale: 1,
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
})
