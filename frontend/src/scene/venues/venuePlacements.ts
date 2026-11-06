import { BASEBALL_PATH } from '../../baseball/baseballRoute'
import type { TownObject, TownVenues, Vec3 } from '../../data/models'
import { type AppLanguage, languageCopy } from '../../i18n/language'
import { getTownRoads, type TownRoad } from '../objects/roads/roadLayout'
import type { StatueSpot } from '../playerInteraction'
import type { TownCollision } from '../townCollision'
import {
  BALLPARK_GARDEN,
  type PodiumGarden,
  podiumCardSpots,
  podiumGardenBranch,
  podiumGardenCollision,
} from './ballpark/ballparkStatueLayout'
import { VENUE_SLOTS, type VenueSlotId, venueEntrance } from './venueSlots'

export type VenueId = keyof TownVenues

/**
 * Where each venue stands, the page its gate leads to, and the podium garden it keeps inside the hedge. The gate leaves
 * by a full page load, never a client-side route: each page gets its own headers from nginx, and `/`'s `camera=()`
 * would otherwise keep the camera closed.
 */
export const VENUE_PLACEMENTS = {
  ballpark: { slot: 'north', href: BASEBALL_PATH, garden: BALLPARK_GARDEN },
} satisfies Record<VenueId, { slot: VenueSlotId; href: string; garden: PodiumGarden }>

export const VENUE_IDS = Object.keys(VENUE_PLACEMENTS) as VenueId[]

/** The venues the admin shows. A hidden one has no exterior, gate, or prompt, and its stretch of hedge stays closed. */
export function openVenueIds(venues: TownVenues) {
  return VENUE_IDS.filter((id) => venues[id].visible)
}

export function openVenueSlots(venues: TownVenues) {
  return openVenueIds(venues).map((id) => VENUE_SLOTS[VENUE_PLACEMENTS[id].slot])
}

/** The middle of a venue's gate on the hedge line, whether or not it is shown: where the editor's camera frames it. */
export function getVenueGatePoint(id: VenueId): Vec3 {
  const [x, z] = VENUE_SLOTS[VENUE_PLACEMENTS[id].slot].gate
  return { x, y: 0, z }
}

/** A shown venue's gate, as the player's prompt offers it: where to stand, what it says, and where it leads. */
export type VenueEntrance = { id: VenueId; href: string; label: string; x: number; z: number }

export function getVenueEntrances(venues: TownVenues, language: AppLanguage): VenueEntrance[] {
  return openVenueIds(venues).map((id) => {
    const [x, z] = venueEntrance(VENUE_SLOTS[VENUE_PLACEMENTS[id].slot])
    return { id, href: VENUE_PLACEMENTS[id].href, label: languageCopy[language].venues[id].enter, x, z }
  })
}

/** The town's roads and the shown venues' own, such as the branch to a podium garden, as the ground paints them. */
export function getGroundRoads(roadObjects: TownObject[], venues: TownVenues): TownRoad[] {
  const roads = getTownRoads(roadObjects)
  const venueRoads = openVenueIds(venues).map((id) =>
    podiumGardenBranch(VENUE_PLACEMENTS[id].garden, VENUE_SLOTS[VENUE_PLACEMENTS[id].slot], roads),
  )
  return [...roads, ...venueRoads]
}

/** Where the shown venues' statue cards open. */
export function getStatueSpots(venues: TownVenues): StatueSpot[] {
  return openVenueIds(venues).flatMap((id) =>
    podiumCardSpots(VENUE_PLACEMENTS[id].garden, VENUE_SLOTS[VENUE_PLACEMENTS[id].slot]),
  )
}

/** What the visitor cannot walk through in the shown venues' podium gardens. */
export function getVenueCollision(venues: TownVenues): TownCollision {
  const solids = openVenueIds(venues).map((id) =>
    podiumGardenCollision(VENUE_PLACEMENTS[id].garden, VENUE_SLOTS[VENUE_PLACEMENTS[id].slot]),
  )
  return { boxes: solids.flatMap(({ boxes }) => boxes), circles: solids.flatMap(({ circles }) => circles) }
}
