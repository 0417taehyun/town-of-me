import { type BattingSide, MOUND_DISTANCE } from '../game/field'
import { MOUND } from '../stadium/fieldLayout'

// Where the stage's players stand, in field meters (baseball/game/field.ts). The batter, pitcher, and catcher are town
// characters scaled to a player's height (stage/actors).

export const PLAYER_HEIGHT = 1.75
/** The town character's height in its own units. */
export const TOWN_CHARACTER_HEIGHT = 2.1
export const PLAYER_SCALE = PLAYER_HEIGHT / TOWN_CHARACTER_HEIGHT

/**
 * The pitcher stands on the rubber facing home; the catcher crouches behind the plate facing the pitcher, far enough
 * back that his head stays under the batting shot's view of home plate, not over it or the strike zone's box.
 */
export const PITCHER_SPOT = { x: 0, y: MOUND.height, z: -MOUND_DISTANCE }
export const CATCHER_SPOT = { x: 0, y: 0, z: 2.6 }
/** The catcher's mitt, in meters in front of the plate center (minus: behind it), where a pitch not hit ends up. */
export const MITT_DEPTH = -2.15

/** A right-handed batter stands on the third-base side of the plate (-x), a left-handed one mirrored. */
export function batterSpot(side: BattingSide) {
  return { x: side === 'left' ? 0.75 : -0.75, y: 0, z: 0 }
}
