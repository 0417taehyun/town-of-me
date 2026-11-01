import type { StanceFrame } from './flow/stanceHold'
import { contactHeight, contactSeconds } from './game/pitch'
import type { RealTimeSwing, StageEvent } from './stage/stageRun'

// Dev builds only. The fake camera an automated check uses in headless Chrome shows no person, so nobody could hold
// the stance, stay in view, or swing; this seam stands in for one. In the page's console,
// `townOfMeDerbyDev.visitor('stance')` has the camera see a visitor in the batting stance (`'standing'` in view out of
// it, `'away'` out of view, `null` the camera's own picture again), and `townOfMeDerbyDev.swing(-150, 0, 120)` swings
// at each of the next pitches that many ms after (minus: before) the ball reaches the contact point. A stand-in swing
// is a camera swing: the camera's frames report it a little late, through the same hand-over as a tracked one
// (cameraTracking.ts). BaseballApp.tsx and cameraTracking.ts reach this module only behind `import.meta.env.DEV`, so a
// production build leaves it out: its `dist/` holds no "townOfMeDerbyDev".

export type DevVisitor = 'stance' | 'standing' | 'away'

/** The stand-in visitor, the swing errors (ms) asked for the next pitches, and the swings already on their way. */
export const DEV_SEAM: { visitor: DevVisitor | null; swingErrorsMs: number[]; coming: RealTimeSwing[] } = {
  visitor: null,
  swingErrorsMs: [],
  coming: [],
}

/** How late (ms) after its contact moment a camera frame reports a stand-in swing, about as late as the tracker's. */
export const DEV_SWING_REPORT_MS = 120

/** Puts `townOfMeDerbyDev` on the page until the returned function takes it away again. */
export function installDevSeam() {
  const page = window as Window & { townOfMeDerbyDev?: unknown }
  page.townOfMeDerbyDev = {
    visitor: (visitor: DevVisitor | null) => {
      DEV_SEAM.visitor = visitor
    },
    swing: (...errorsMs: number[]) => {
      DEV_SEAM.swingErrorsMs.push(...errorsMs)
    },
  }
  return () => {
    delete page.townOfMeDerbyDev
    Object.assign(DEV_SEAM, { visitor: null, swingErrorsMs: [], coming: [] })
  }
}

/**
 * What the camera sees of the stand-in visitor at `time`: whether they are in view, and their stance, held still; one
 * `standing` holds the bat low, so the stance waits for it to be raised.
 */
export function devVisitorFrame(time: number): { seen: boolean; stance: StanceFrame } | null {
  const { visitor } = DEV_SEAM
  if (visitor === null) return null
  if (visitor === 'away') return { seen: false, stance: { time, pose: 'show', grip: null, shoulderWidth: null } }
  const pose = visitor === 'stance' ? null : 'raise'
  return { seen: true, stance: { time, pose, grip: { x: 0.45, y: 0.55 }, shoulderWidth: 0.2 } }
}

/** On a pitch's release, the stand-in swing asked for it, if any, on its way for the camera's frames to report. */
export function queueDevSwing(event: StageEvent) {
  if (event.type !== 'release') return
  const errorMs = DEV_SEAM.swingErrorsMs.shift()
  if (errorMs === undefined) return
  const contactAtRealMs = performance.now() + contactSeconds(event.pitch) * 1000 + errorMs
  DEV_SEAM.coming.push({
    contactAtRealMs,
    startedAtRealMs: contactAtRealMs - 250,
    speed: 9,
    batHeight: contactHeight(event.pitch),
  })
}

/** The stand-in swing a camera frame taken at `time` (performance.now() ms) reports, once one is due. */
export function devSwingSeen(time: number): RealTimeSwing | null {
  const [next] = DEV_SEAM.coming
  if (!next || time < next.contactAtRealMs + DEV_SWING_REPORT_MS) return null
  DEV_SEAM.coming.shift()
  return next
}
