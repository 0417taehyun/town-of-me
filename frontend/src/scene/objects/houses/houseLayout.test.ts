import { describe, expect, it } from 'vitest'
import type { TownObject } from '../../../data/models'
import { SAMPLE_TOWN } from '../../../testing/sampleTown'
import {
  getHouseApproachPosition,
  HOUSE_DOOR_POSITION,
  HOUSE_MAILBOX_POSITION,
  houseLocalPointToWorld,
} from './houseLayout'

const houses = SAMPLE_TOWN.objects.filter((object) => object.type === 'house')

describe('house layout', () => {
  it.each(houses)('$id faces +Z like every house', (house) => {
    const [approachX, , approachZ] = getHouseApproachPosition(house)
    const [doorX, , doorZ] = houseLocalPointToWorld(house, HOUSE_DOOR_POSITION)
    expect(approachX).toBeCloseTo(house.position.x)
    expect(doorX).toBeCloseTo(house.position.x)
    expect(approachZ).toBeGreaterThan(doorZ)
    expect(doorZ).toBeGreaterThan(house.position.z)
  })

  it.each(houses)('$id keeps its mailbox on the visitor-left of the entrance', (house: TownObject) => {
    const [mailboxX, , mailboxZ] = houseLocalPointToWorld(house, HOUSE_MAILBOX_POSITION)
    const rotation = house.rotation ?? 0
    const frontX = Math.sin(rotation)
    const frontZ = Math.cos(rotation)
    const mailboxOffsetX = mailboxX - house.position.x
    const mailboxOffsetZ = mailboxZ - house.position.z
    const visitorSide = frontZ * mailboxOffsetX - frontX * mailboxOffsetZ
    expect(visitorSide).toBeLessThan(0)
    expect(mailboxX).toBeLessThan(house.position.x)
  })
})
