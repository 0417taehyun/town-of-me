import { describe, expect, it } from 'vitest'
import { SAMPLE_TOWN } from '../../../testing/sampleTown'
import { getRoadWorldPoints } from './roadLayout'

describe('town road layout', () => {
  it('keeps road points relative to the road, so moving a road keeps its shape', () => {
    const road = SAMPLE_TOWN.objects.find(({ id }) => id === 'road-north-south')!
    const moved = { ...road, position: { x: 5, y: 0, z: -2 } }
    expect(getRoadWorldPoints(moved)[0]).toEqual([road.points![0][0] + 5, road.points![0][1] - 2])
  })
})
