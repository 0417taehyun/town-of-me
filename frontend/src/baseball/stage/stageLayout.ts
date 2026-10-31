import type { Vec3 } from '../../data/models'
import { type BattingSide, MOUND_DISTANCE } from '../game/field'
import { MOUND } from '../stadium/fieldLayout'

// Where the stage's players stand and hold the ball, in field meters (baseball/game/field.ts). The batter, pitcher,
// and catcher are town characters scaled to a player's height.

export const PLAYER_HEIGHT = 1.75
/** The town character's height in its own units. */
export const TOWN_CHARACTER_HEIGHT = 2.1
export const PLAYER_SCALE = PLAYER_HEIGHT / TOWN_CHARACTER_HEIGHT

/**
 * The pitcher stands on the rubber facing home; the catcher sits behind the plate facing the pitcher, a little low, so
 * his head stays under the batting shot's line of sight to the back of the plate.
 */
export const PITCHER_SPOT = { x: 0, y: MOUND.height, z: -MOUND_DISTANCE }
export const CATCHER_SPOT = { x: 0, y: -0.15, z: 1.9 }
/** The catcher's mitt, in meters in front of the plate center (minus: behind it), where a pitch not hit ends up. */
export const MITT_DEPTH = -1.45

/** A right-handed batter stands on the third-base side of the plate (-x), a left-handed one mirrored. */
export function batterSpot(side: BattingSide) {
  return { x: side === 'left' ? 0.75 : -0.75, y: 0, z: 0 }
}

/**
 * The ball's windup, from the glove in front of the pitcher's chest up behind the throwing shoulder; it is thrown from
 * there to the release point (game/pitch.ts RELEASE_POINT) as the windup ends.
 */
export const WINDUP_POINTS: { glove: Vec3; cocked: Vec3 } = {
  glove: { x: 0.05, y: MOUND.height + 1, z: -MOUND_DISTANCE + 0.32 },
  cocked: { x: -0.45, y: MOUND.height + 1.85, z: -MOUND_DISTANCE - 0.5 },
}
