import type { DemoSession } from '../data/models'
import { isDefaultProfile, normalizePlayerProfile, type PlayerProfile } from '../data/playerProfile'

/** A visitor plays as their town character, so one who has neither entered the town nor made one makes one first. */
export function needsCharacter(session: DemoSession) {
  return !session.ui.instructionsDismissed && isDefaultProfile(normalizePlayerProfile(session.profile))
}

/**
 * The session after a visitor makes their character at the ballpark. Unlike `createVisitorSession`, it keeps the town
 * as it was: where they stood, the camera, the guide, and the town's entry, which a visitor who started here still sees.
 */
export function withVenueProfile(session: DemoSession, profile: PlayerProfile): DemoSession {
  return { ...session, profile }
}
