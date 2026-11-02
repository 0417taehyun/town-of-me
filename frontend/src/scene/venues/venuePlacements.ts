import { BASEBALL_PATH } from '../../baseball/baseballRoute'
import type { TownVenues } from '../../data/models'
import { type AppLanguage, languageCopy } from '../../i18n/language'
import { VENUE_SLOTS, type VenueSlotId, venueEntrance } from './venueSlots'

export type VenueId = keyof TownVenues

/**
 * Where each venue stands and the page its gate leads to. The gate leaves by a full page load, never a client-side
 * route: each page gets its own headers from nginx, and `/`'s `camera=()` would otherwise keep the camera closed.
 */
export const VENUE_PLACEMENTS = {
  ballpark: { slot: 'north', href: BASEBALL_PATH },
} satisfies Record<VenueId, { slot: VenueSlotId; href: string }>

export const VENUE_IDS = Object.keys(VENUE_PLACEMENTS) as VenueId[]

/** The venues the admin shows. A hidden one has no exterior, gate, or prompt, and its stretch of hedge stays closed. */
export function openVenueIds(venues: TownVenues) {
  return VENUE_IDS.filter((id) => venues[id].visible)
}

export function openVenueSlots(venues: TownVenues) {
  return openVenueIds(venues).map((id) => VENUE_SLOTS[VENUE_PLACEMENTS[id].slot])
}

/** A shown venue's gate, as the player's prompt offers it: where to stand, what it says, and where it leads. */
export type VenueEntrance = { id: VenueId; href: string; label: string; x: number; z: number }

export function getVenueEntrances(venues: TownVenues, language: AppLanguage): VenueEntrance[] {
  return openVenueIds(venues).map((id) => {
    const [x, z] = venueEntrance(VENUE_SLOTS[VENUE_PLACEMENTS[id].slot])
    return { id, href: VENUE_PLACEMENTS[id].href, label: languageCopy[language].venues[id].enter, x, z }
  })
}
