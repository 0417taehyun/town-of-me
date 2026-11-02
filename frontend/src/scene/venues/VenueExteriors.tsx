import { lazy, Suspense, useMemo } from 'react'
import type { ComponentType, MutableRefObject } from 'react'
import type { TownObject, TownVenues } from '../../data/models'
import type { AppLanguage } from '../../i18n/language'
import type { SeasonChange } from '../environment/seasonTransition'
import { getTownRoads } from '../objects/roads/roadLayout'
import type { TownLayerProps } from '../objects/townObjectKind'
import { openVenueIds, VENUE_PLACEMENTS, type VenueId } from './venuePlacements'
import { gateRoadColor, VENUE_SLOTS } from './venueSlots'

/** What a venue's exterior draws from: its settings, and the town's season, lamps, and language. */
export type VenueExteriorProps<Id extends VenueId> = {
  settings: TownVenues[Id]
  seasonChange: MutableRefObject<SeasonChange>
  lampsOn: boolean
  language: AppLanguage
  /** Holds what moves on its own, such as the statues' twinkles: reduced motion, or the town's motion turned off. */
  still: boolean
  /** The color of the town road that runs up to the gate, which the venue's approach carries on. */
  approachColor: string
}

/** How each venue looks from the town, drawn in its slot's frame; its code loads only once the admin shows it. */
const VENUE_EXTERIORS: { [Id in VenueId]: ComponentType<VenueExteriorProps<Id>> } = {
  ballpark: lazy(() => import('./ballpark/BallparkExterior').then((module) => ({ default: module.BallparkExterior }))),
}

/** Every venue the admin shows, past its gate in the hedge; a hidden venue neither draws nor downloads anything. */
export function VenueExteriors({
  venues,
  roads,
  scene,
}: {
  venues: TownVenues
  roads: TownObject[]
  scene: TownLayerProps
}) {
  const townRoads = useMemo(() => getTownRoads(roads), [roads])
  return openVenueIds(venues).map((id) => {
    const slot = VENUE_SLOTS[VENUE_PLACEMENTS[id].slot]
    const Exterior = VENUE_EXTERIORS[id]
    return (
      <group key={id} position={[slot.gate[0], 0, slot.gate[1]]} rotation-y={slot.rotation}>
        <Suspense fallback={null}>
          <Exterior
            settings={venues[id]}
            seasonChange={scene.seasonChange}
            lampsOn={scene.lampsOn}
            language={scene.language}
            still={scene.reducedMotion || !scene.motionEnabled}
            approachColor={gateRoadColor(townRoads, slot)}
          />
        </Suspense>
      </group>
    )
  })
}
