import type { StanceFrame } from './flow/stanceHold'
import { contactHeight, contactSeconds } from './game/pitch'
import type { RealTimeSwing, StageEvent } from './stage/stageRun'

// Dev builds only. The fake camera an automated check uses in headless Chrome shows no person, so nobody could hold
// the stance, stay in view, or swing; this seam stands in for one. In the page's console,
// `townOfMeDerbyDev.visitor('stance')` has the camera see a visitor in the batting stance (`'standing'` in view out of
// it, `'away'` out of view, `null` the camera's own picture again), and `townOfMeDerbyDev.swing(-150, 0, 120)` swings
// at each of the next pitches that many ms after (minus: before) the ball reaches the contact point, as a camera swing
// seen a little late. BaseballApp.tsx and cameraTracking.ts reach this module only behind `import.meta.env.DEV`, so a
// production build leaves it out: its `dist/` holds no "townOfMeDerbyDev".

export type DevVisitor = 'stance' | 'standing' | 'away'

export const DEV_SEAM: { visitor: DevVisitor | null; swingErrorsMs: number[] } = { visitor: null, swingErrorsMs: [] }

/** How late (ms) after its contact moment a stand-in swing reaches the page, about as late as the tracker's. */
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
    Object.assign(DEV_SEAM, { visitor: null, swingErrorsMs: [] })
  }
}

/** What the camera sees of the stand-in visitor at `time`: whether they are in view, and their stance, if any. */
export function devVisitorFrame(time: number): { seen: boolean; stance: StanceFrame } | null {
  const { visitor } = DEV_SEAM
  if (visitor === null) return null
  if (visitor === 'away') return { seen: false, stance: { time, inStance: false, grip: null, shoulderWidth: null } }
  const stance = { time, inStance: visitor === 'stance', grip: { x: 0.45, y: 0.55 }, shoulderWidth: 0.2 }
  return { seen: true, stance }
}

/** On a pitch's release, the stand-in swing queued for it, if any, handed to `push` as late as a camera's would be. */
export function devSwingAt(event: StageEvent, push: (swing: RealTimeSwing) => void) {
  if (event.type !== 'release') return
  const errorMs = DEV_SEAM.swingErrorsMs.shift()
  if (errorMs === undefined) return
  const contactAtRealMs = performance.now() + contactSeconds(event.pitch) * 1000 + errorMs
  const swing: RealTimeSwing = {
    source: 'camera',
    contactAtRealMs,
    startedAtRealMs: contactAtRealMs - 250,
    speed: 9,
    batHeight: contactHeight(event.pitch),
  }
  setTimeout(() => push(swing), contactAtRealMs - performance.now() + DEV_SWING_REPORT_MS)
}
