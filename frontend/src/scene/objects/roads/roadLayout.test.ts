import { describe, expect, it } from 'vitest'
import { SAMPLE_TOWN } from '../../../testing/sampleTown'
import { getHouseApproachPosition } from '../houses/houseLayout'
import { getRoadWorldPoints, getTownRoads } from './roadLayout'

describe('town road layout', () => {
  it('connects every sample house entrance to the shared road network', () => {
    const houses = SAMPLE_TOWN.objects.filter(({ type }) => type === 'house')
    const roads = getTownRoads(SAMPLE_TOWN.objects)
    houses.forEach((house) => {
      const road = roads.find(({ id }) => id === `road-${house.id}`)!
      const [approachX, , approachZ] = getHouseApproachPosition(house)
      expect(road.points.at(-1)).toEqual([approachX, approachZ])
      expect(road.points).toHaveLength(3)
    })
  })

  it('keeps road points relative to the road, so moving a road keeps its shape', () => {
    const road = SAMPLE_TOWN.objects.find(({ id }) => id === 'road-north-south')!
    const moved = { ...road, position: { x: 5, y: 0, z: -2 } }
    expect(getRoadWorldPoints(moved)[0]).toEqual([road.points![0][0] + 5, road.points![0][1] - 2])
    expect(getTownRoads([moved])[0]).toMatchObject({ color: '#d7c79f', width: 6 })
  })
})
