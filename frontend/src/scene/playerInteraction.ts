import type { Vector3 } from 'three'
import type { TownObject, Vec3 } from '../data/models'
import type { ResidentQuestion, ResidentQuestionId } from '../data/residentDialogue'
import type { BenchSeat } from './motion/characterPose'
import { getHouseApproachPosition } from './objects/houses/houseLayout'
import type { WorldActor } from './motion/npcMotion'
import type { StatueRank } from './statues/statueFinishes'
import type { VenueEntrance } from './venues/venuePlacements'

export type DialogueMessage = {
  speaker: string
  text: string
  avatar: string
  actorId: string
  voice?: 'resident'
  /** A validated link shown under the line, such as the resident's LinkedIn or the owner's contact email. */
  link?: { href: string; label: string }
  choices?: readonly ResidentQuestion[]
  /** Questions already asked in this conversation, so they are not offered again. */
  asked?: readonly ResidentQuestionId[]
}
export type InteractionRequest = { sequence: number; action: 'interact' | 'greet' } | null

export type Interaction = {
  id: string
  kind: 'actor' | 'bench' | 'guestbook' | 'house' | 'venue' | 'statue'
  label: string
  actorId?: string
  seat?: BenchSeat
  /** The page a venue's gate leads to. */
  href?: string
  /** The place a statue stands for, whose card shows while the visitor is near, and where the statue stands. */
  statue?: { rank: StatueRank; x: number; z: number }
}

/** Where a visitor stands to read a statue's card, and the statue it is about, which the camera frames with them. */
export type StatueSpot = { rank: StatueRank; x: number; z: number; statue: { x: number; z: number } }

/** A statue's card opens this near its spot. */
export const STATUE_CARD_RADIUS = 2.4
/** The camera frames a statue with the visitor only once they have stood still this long, never while walking by. */
export const STATUE_FRAMING_SECONDS = 0.4

/** The item closest by `distanceSquared`, the earlier one on a tie; null when there are none. */
export function findNearest<Item>(items: readonly Item[], distanceSquared: (item: Item) => number) {
  return items.reduce<Item | null>(
    (nearest, item) => (!nearest || distanceSquared(item) < distanceSquared(nearest) ? item : nearest),
    null,
  )
}

/** Squared distance across the ground, ignoring height. */
export function groundDistanceSquared(position: Vector3, point: { x: number; z: number }) {
  return (position.x - point.x) ** 2 + (position.z - point.z) ** 2
}

export function houseDoorDistanceSquared(position: Vector3, house: TownObject) {
  const [x, , z] = getHouseApproachPosition(house)
  return groundDistanceSquared(position, { x, z })
}

/**
 * The statue the camera frames with the visitor, as it frames a conversation, set into `focus`: the one whose card is
 * open once they have stood still `stillSeconds`; none while they walk by.
 */
export function framedStatue(interaction: Interaction | null, stillSeconds: number, focus: Vector3) {
  const statue = interaction?.statue
  if (!statue || stillSeconds < STATUE_FRAMING_SECONDS) return null
  return focus.set(statue.x, focus.y, statue.z)
}

/** Whether a prompt would read the same, so it is not re-sent every frame. */
export function isSameInteraction(first: Interaction | null, second: Interaction | null) {
  return first?.id === second?.id && first?.label === second?.label
}

/** What the player may interact with nearby, and the prompts' labels in the visitor's language. */
export type NearbyInteractionOptions = {
  actors: WorldActor[]
  seats: BenchSeat[]
  houses?: TownObject[]
  guestbookPosition?: Vec3 | null
  venueEntrances?: VenueEntrance[]
  statueSpots?: StatueSpot[]
  labels: { guestbook: string; house: string; pet: string; statue: string }
}

export function getNearbyInteraction(
  position: Vector3,
  {
    actors,
    seats,
    houses = [],
    guestbookPosition = null,
    venueEntrances = [],
    statueSpots = [],
    labels,
  }: NearbyInteractionOptions,
): Interaction | null {
  const actor = findNearest(actors, (candidate) => position.distanceToSquared(candidate.position))
  if (actor && actor.position.distanceToSquared(position) < 2.6 ** 2) {
    return {
      id: actor.id,
      actorId: actor.id,
      kind: 'actor',
      label: actor.kind === 'dog' ? labels.pet : `Talk to ${actor.name}`,
    }
  }

  const statue = findNearest(statueSpots, (candidate) => groundDistanceSquared(position, candidate))
  if (statue && groundDistanceSquared(position, statue) < STATUE_CARD_RADIUS ** 2) {
    const { rank } = statue
    return { id: `statue-${rank}`, kind: 'statue', label: labels.statue, statue: { rank, ...statue.statue } }
  }

  const guestbookDistance = guestbookPosition ? groundDistanceSquared(position, guestbookPosition) : Infinity
  if (guestbookDistance < 3 ** 2) return { id: 'town-guestbook', kind: 'guestbook', label: labels.guestbook }

  const house = findNearest(houses, (candidate) => houseDoorDistanceSquared(position, candidate))
  if (house && houseDoorDistanceSquared(position, house) < 2.6 ** 2)
    return { id: `door-${house.id}`, kind: 'house', label: labels.house }

  const entrance = findNearest(venueEntrances, (candidate) => groundDistanceSquared(position, candidate))
  if (entrance && groundDistanceSquared(position, entrance) < 3 ** 2)
    return { id: `venue-${entrance.id}`, kind: 'venue', label: entrance.label, href: entrance.href }

  const freeSeats = seats.filter((seat) => !actors.some((actor) => actor.seatId === seat.id))
  const seat = findNearest(freeSeats, (candidate) => groundDistanceSquared(position, candidate))
  if (!seat || groundDistanceSquared(position, seat) >= 2.5 ** 2) return null
  return { id: seat.id, kind: 'bench', label: 'Sit on bench', seat }
}
