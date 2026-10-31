import { describe, expect, it } from 'vitest'
import { Vector3 } from 'three'
import {
  canActorOccupyPosition,
  createAmbientConversation,
  createResidentMotion,
  createResidentSpecs,
  createWorldActors,
  getHeadYawToward,
  getResidentSkyGazeTilt,
  isActorConversationInRange,
  nextRouteIndex,
  stepResidentMotion,
  stopBlockedMotion,
  turnResidentToward,
} from './npcMotion'
import { getBenchPose, getBenchSeats } from './characterPose'
import { SAMPLE_TOWN } from '../../testing/sampleTown'

const residentSpecs = createResidentSpecs(SAMPLE_TOWN.residents)
const createSeedWorldActors = () => createWorldActors(residentSpecs)
const fountain = [{ x: 0, z: 0, radius: 2.5 }]

describe('nextRouteIndex', () => {
  it('keeps wandering on a connected loop in either direction', () => {
    expect(nextRouteIndex(0, 4, 0.1)).toBe(3)
    expect(nextRouteIndex(3, 4, 0.9)).toBe(0)
    expect(nextRouteIndex(0, 1, 0.9)).toBe(0)
  })
})

describe('resident sky gaze', () => {
  it('holds a clearly raised head for five seconds during an occasional idle window', () => {
    expect(getResidentSkyGazeTilt(12, 0, true)).toBe(0)
    expect(getResidentSkyGazeTilt(21, 0, true)).toBeCloseTo(-0.62)
    expect(getResidentSkyGazeTilt(25.5, 0, true)).toBeCloseTo(-0.62)
    expect(getResidentSkyGazeTilt(26.1, 0, true)).toBeLessThan(0)
    expect(getResidentSkyGazeTilt(27, 0, true)).toBe(0)
    expect(getResidentSkyGazeTilt(21, 0, false)).toBe(0)
    expect(getResidentSkyGazeTilt(13.7, 7.3, true)).toBeCloseTo(-0.62)
  })
})

describe('resident seating and interaction', () => {
  const resident = residentSpecs.find((spec) => spec.id === 'juno')!
  const seat = getBenchSeats(SAMPLE_TOWN.objects).find((candidate) => candidate.id === resident.benchId)!

  it('starts on the actual seat, then stands in front and leaves for another waypoint', () => {
    const initial = createResidentMotion(resident, seat)
    expect(initial).toMatchObject({ ...getBenchPose(seat, true), animation: 'sit' })
    expect(initial.routeIndex).not.toBe(resident.seatIndex)
    const standing = stepResidentMotion(initial, resident, seat, 9, 0.016, false, false, 0.1)
    expect(standing).toMatchObject({ ...getBenchPose(seat, false), animation: 'idle' })
    const walking = stepResidentMotion(standing, resident, seat, 10, 0.016, false, false, 0.1)
    expect(walking.animation).toBe('walk')
    expect(walking.speed).toBeGreaterThan(0)
    expect(walking.speed).toBeLessThan(2.2)
    expect(walking.y).toBeCloseTo(0.88)
  })

  it('never sits through the player and pauses to talk without resetting a seated pose', () => {
    const approaching = {
      ...createResidentMotion(resident, seat),
      ...getBenchPose(seat, false),
      routeIndex: resident.seatIndex,
      seatedUntil: 0,
      animation: 'walk' as const,
    }
    const blocked = stepResidentMotion(approaching, resident, seat, 10, 0.016, false, true, 0.1)
    expect(blocked.animation).toBe('idle')
    const sitting = stepResidentMotion(approaching, resident, seat, 10, 0.016, false, false, 0.1)
    expect(sitting.animation).toBe('sit')
    expect(stepResidentMotion(sitting, resident, seat, 11, 0.016, true, false, 0.1)).toEqual(sitting)
    const talking = stepResidentMotion(approaching, resident, seat, 10, 0.016, true, false, 0.1)
    expect(talking).toMatchObject({ x: approaching.x, z: approaching.z, animation: 'idle' })
  })

  it('keeps turning toward the person it is speaking with across frames', () => {
    const targetRotation = Math.PI / 2
    const firstRotation = turnResidentToward(0, 0, 0, 2, 0, 1 / 60)
    const secondRotation = turnResidentToward(firstRotation, 0, 0, 2, 0, 1 / 60)
    expect(firstRotation).toBeGreaterThan(0)
    expect(Math.abs(targetRotation - secondRotation)).toBeLessThan(Math.abs(targetRotation - firstRotation))
  })

  it('can reuse its next-frame buffer without mutating the current frame', () => {
    const current = createResidentMotion(resident, seat)
    const before = { ...current }
    const buffer = { ...current }
    expect(stepResidentMotion(current, resident, seat, 9, 0.016, false, false, 0.1, buffer)).toBe(buffer)
    expect(current).toEqual(before)
    expect(buffer.animation).toBe('idle')
  })

  it('keeps moving actors outside each other and the player', () => {
    const actors = createSeedWorldActors()
    const actor = actors[0]
    const other = actors[1]
    expect(
      canActorOccupyPosition(actor, other.position.x, other.position.z, actors, new Vector3(50, 0, 50), fountain),
    ).toBe(false)
    expect(canActorOccupyPosition(actor, 5, 5, actors, new Vector3(5, 0, 5), fountain)).toBe(false)
    expect(canActorOccupyPosition(actor, 40, 40, actors, new Vector3(50, 0, 50), fountain)).toBe(true)
    const pet = actors.find((candidate) => candidate.id === 'pet')!
    expect(pet.radius).toBeGreaterThan(actor.radius)
    expect(
      canActorOccupyPosition(pet, actor.position.x + 1.1, actor.position.z, actors, new Vector3(50, 0, 50), fountain),
    ).toBe(false)

    const current = createResidentMotion(resident, seat)
    const candidate = { ...current, x: current.x + 1, speed: 2, animation: 'walk' as const }
    const rerouted = stopBlockedMotion(current, candidate, 3, resident.route.length, 0.9)
    expect(rerouted).toMatchObject({
      x: current.x,
      z: current.z,
      routeIndex: nextRouteIndex(current.routeIndex, resident.route.length, 0.9),
      speed: 0,
      animation: 'idle',
    })
    expect(rerouted.waitUntil).toBeCloseTo(3.8)
  })

  it('keeps every moving actor outside the fountain, wherever it stands', () => {
    const actors = createSeedWorldActors()
    const player = new Vector3(50, 0, 50)
    const movedFountain = [{ x: 20, z: -10, radius: 2.5 }]
    actors.forEach((actor) => {
      expect(canActorOccupyPosition(actor, 0, 0, actors, player, fountain)).toBe(false)
      expect(canActorOccupyPosition(actor, 4, 0, actors, player, fountain)).toBe(true)
      expect(canActorOccupyPosition(actor, 20, -10, actors, player, movedFountain)).toBe(false)
      expect(canActorOccupyPosition(actor, 0, 0, actors, player, movedFountain)).toBe(true)
    })
  })

  it('starts occasional local resident conversations only for a nearby free pair', () => {
    const actors = createSeedWorldActors()
    actors[1].position.copy(actors[0].position).add(new Vector3(2, 0, 0))
    actors[2].position.set(40, 0, 40)
    const conversation = createAmbientConversation(actors, 0, 100, [['Hello!', 'Hi!']])
    expect(conversation?.messages.map(({ actorId }) => actorId)).toEqual([actors[0].id, actors[1].id])
    expect(conversation?.messages.every(({ text }) => text.length > 0)).toBe(true)
    actors[0].interactionUntil = 101
    expect(createAmbientConversation(actors, 0, 100, [['Hello!', 'Hi!']])).toBeNull()
  })

  it('keeps a conversation only while its actor remains nearby', () => {
    const actors = createSeedWorldActors()
    const player = actors[0].position.clone()
    expect(isActorConversationInRange(actors[0].id, player, actors)).toBe(true)
    player.x += 3.5
    expect(isActorConversationInRange(actors[0].id, player, actors)).toBe(false)
    expect(isActorConversationInRange(null, player, actors)).toBe(true)
  })

  it('turns the head toward someone nearby within its reach, and not toward someone far away or behind', () => {
    expect(getHeadYawToward(0, 0, 0, 0.5, 2)).toBeCloseTo(Math.atan2(0.5, 2))
    expect(getHeadYawToward(0, 0, 0, -0.5, 2)).toBeCloseTo(-Math.atan2(0.5, 2))
    expect(getHeadYawToward(0, 0, 0, 2, 2)).toBeCloseTo(0.7)
    expect(getHeadYawToward(0, 0, Math.PI / 2, 2, 0.5)).toBeCloseTo(Math.atan2(2, 0.5) - Math.PI / 2)
    expect(getHeadYawToward(0, 0, 3, Math.sin(-3) * 2, Math.cos(-3) * 2)).toBeCloseTo(2 * Math.PI - 6)
    expect(getHeadYawToward(0, 0, 0, 0, 5)).toBe(0)
    expect(getHeadYawToward(0, 0, 0, 0.1, -2)).toBe(0)
  })
})
