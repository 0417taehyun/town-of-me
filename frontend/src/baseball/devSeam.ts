import type { PoseNeed, StanceFrame } from './flow/stanceHold'
import { contactHeight, contactSeconds } from './game/pitch'
import type { RealTimeSwing, StageEvent } from './stage/stageRun'
import type { SwingCue } from './vision/swingTracker'

// Dev builds only. The fake camera an automated check uses in headless Chrome shows no person, so nobody could hold the
// stance, stay in view, or swing; this seam stands in for one. In the page's console,
// `townOfMeDerbyDev.visitor('stance')` has the camera see a visitor in the batting stance (`'standing'` in view with
// the hands low, `'apart'` with them apart, `'edge'` at the picture's edge, `'searching'` before the lock, `'away'` out
// of view, `null` the camera's own picture again), and `townOfMeDerbyDev.swing(-150, 0, 120)` swings at each of the
// next pitches that many ms after (minus: before) the ball reaches the contact point; `townOfMeDerbyDev.check(0)`
// begins one at the next pitch and checks it. A stand-in swing is a camera swing: the camera's frames cue its start a
// little before its contact moment and report it a little late, through the same hand-over as a tracked one
// (cameraTracking.ts). BaseballApp.tsx and cameraTracking.ts reach this module only behind `import.meta.env.DEV`, so a
// production build leaves it out: its `dist/` holds no "townOfMeDerbyDev".

export type DevVisitor = 'stance' | 'standing' | 'apart' | 'edge' | 'searching' | 'away'

/** What each stand-in visitor in view lacks of the stance. */
export const DEV_VISITOR_POSES: Record<Exclude<DevVisitor, 'away'>, PoseNeed | null> = {
  stance: null,
  standing: 'raise',
  apart: 'together',
  edge: 'handsInView',
  searching: 'lock',
}

/** A stand-in swing asked for the next pitch: how many ms off its contact moment, and whether it is checked. */
export type DevSwing = { errorMs: number; checked: boolean }

/** A stand-in swing on its way, and whether the camera's frames have cued its start yet. */
export type ComingDevSwing = { swing: RealTimeSwing; checked: boolean; cued: boolean }

/** The stand-in visitor, the swings asked for the next pitches, and the swings already on their way. */
export const DEV_SEAM: { visitor: DevVisitor | null; swings: DevSwing[]; coming: ComingDevSwing[] } = {
  visitor: null,
  swings: [],
  coming: [],
}

/**
 * How late (ms) after its contact moment a camera frame reports a stand-in swing, about as late as the tracker's, and
 * how early before it the frames cue its start, about as early as the real webcam log's cued swings (26–70 ms).
 */
export const DEV_SWING_REPORT_MS = 120
export const DEV_SWING_CUE_LEAD_MS = 50

/** Puts `townOfMeDerbyDev` on the page until the returned function takes it away again. */
export function installDevSeam() {
  const page = window as Window & { townOfMeDerbyDev?: unknown }
  page.townOfMeDerbyDev = {
    visitor: (visitor: DevVisitor | null) => {
      DEV_SEAM.visitor = visitor
    },
    swing: (...errorsMs: number[]) => {
      DEV_SEAM.swings.push(...errorsMs.map((errorMs) => ({ errorMs, checked: false })))
    },
    check: (...errorsMs: number[]) => {
      DEV_SEAM.swings.push(...errorsMs.map((errorMs) => ({ errorMs, checked: true })))
    },
  }
  return () => {
    delete page.townOfMeDerbyDev
    Object.assign(DEV_SEAM, { visitor: null, swings: [], coming: [] })
  }
}

/**
 * What the camera sees of the stand-in visitor at `time`: whether they are in view, and their stance, held still, with
 * what it lacks (DEV_VISITOR_POSES).
 */
export function devVisitorFrame(time: number): { seen: boolean; stance: StanceFrame } | null {
  const { visitor } = DEV_SEAM
  if (visitor === null) return null
  if (visitor === 'away') return { seen: false, stance: { time, pose: 'show', grip: null, shoulderWidth: null } }
  const pose = DEV_VISITOR_POSES[visitor]
  return { seen: true, stance: { time, pose, grip: { x: 0.45, y: 0.55 }, shoulderWidth: 0.2 } }
}

/** On a pitch's release, the stand-in swing asked for it, if any, on its way for the camera's frames to report. */
export function queueDevSwing(event: StageEvent) {
  if (event.type !== 'release') return
  const asked = DEV_SEAM.swings.shift()
  if (!asked) return
  const contactAtRealMs = performance.now() + contactSeconds(event.pitch) * 1000 + asked.errorMs
  const swing = {
    contactAtRealMs,
    startedAtRealMs: contactAtRealMs - 250,
    speed: 9,
    batHeight: contactHeight(event.pitch),
  }
  DEV_SEAM.coming.push({ swing, checked: asked.checked, cued: false })
}

/** The stand-in swing a camera frame taken at `time` (performance.now() ms) reports once due, unless it is checked. */
export function devSwingSeen(time: number): RealTimeSwing | null {
  const [next] = DEV_SEAM.coming
  if (!next || next.checked || time < next.swing.contactAtRealMs + DEV_SWING_REPORT_MS) return null
  DEV_SEAM.coming.shift()
  return next.swing
}

/**
 * The cue a camera frame taken at `time` gives of the stand-in swing on its way: its start, once DEV_SWING_CUE_LEAD_MS
 * before its contact moment; for a checked one, its check once a swing would have been reported.
 */
export function devSwingCue(time: number): SwingCue | null {
  const [next] = DEV_SEAM.coming
  if (!next) return null
  const { contactAtRealMs } = next.swing
  if (next.checked && next.cued && time >= contactAtRealMs + DEV_SWING_REPORT_MS) {
    DEV_SEAM.coming.shift()
    return { kind: 'checked' }
  }
  if (next.cued || time < contactAtRealMs - DEV_SWING_CUE_LEAD_MS) return null
  next.cued = true
  return { kind: 'started', crossingAtMs: contactAtRealMs }
}
