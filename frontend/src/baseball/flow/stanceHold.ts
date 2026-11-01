import { distance, meanPoint, type Point } from '../vision/poseLandmarks'
import type { SwingTracker } from '../vision/swingTracker'

// The hands-free way on: holding the batting stance about three seconds starts practice, the run after it, and another
// run, the way camera games start on a held pose. Only a stance taken after the step asked for it counts, and none in
// the step's first moments, so a stance kept from the last swing, or a celebration, starts nothing. Moving drains the
// gauge rather than emptying it, a brief tracking dropout neither fills nor drains it, and a full gauge stays full.
// Stillness is measured in the visitor's own shoulder widths, so it means the same near the camera and far from it.
// Times are the camera frames' capture times (ms).

export const STANCE_HOLD_RULES = {
  holdMs: 3000,
  /** A broken stance drains the gauge this many times as fast as holding fills it. */
  drainRate: 2,
  /** How long after a step asks for the stance that none counts. */
  settleMs: 2000,
  /** The grip is still while every grip of the last `stillWindowMs` stays this near their middle (shoulder widths). */
  stillShoulderWidths: 0.15,
  stillWindowMs: 500,
  /** Tracking may lose the visitor this long without the gauge filling or draining. */
  dropoutMs: 200,
  /** The grip is up in the stance when it is no lower than this below the shoulders (shoulder widths). */
  lowestGrip: 1,
}

/**
 * One camera frame as the hold reads it: whether the visitor stands in the batting stance, where the grip is, and their
 * shoulder width (image units); the grip and the width are null when the camera lost them.
 */
export type StanceFrame = { time: number; inStance: boolean; grip: Point | null; shoulderWidth: number | null }

/**
 * A hold for the step `wait` names, asked for at `since`: whether the visitor has been seen out of the stance since
 * (only then is a stance a new one), how long it has been held, and the recent grips that tell stillness.
 */
export type StanceHold = {
  wait: string
  since: number
  armed: boolean
  heldMs: number
  recent: { time: number; grip: Point }[]
  lastTime: number
  lastSeen: number | null
}

/**
 * The frame's stance as the swing tracker sees it: loaded on the batting side with the object locked (or none in free
 * mode), and the grip up by the shoulders rather than hanging at the hip.
 */
export function stanceFrame(tracker: SwingTracker, time: number): StanceFrame {
  const { view } = tracker
  const shoulders = tracker.frame.frontal
  const grip = view && view.source !== 'hold' ? view.grip : null
  if (!grip || !shoulders) return { time, inStance: false, grip: null, shoulderWidth: null }
  const raised = (grip.y - shoulders.midY) / shoulders.width <= STANCE_HOLD_RULES.lowestGrip
  return { time, inStance: tracker.state === 'loaded' && raised, grip, shoulderWidth: shoulders.width }
}

export function startStanceHold(wait: string, since: number): StanceHold {
  return { wait, since, armed: false, heldMs: 0, recent: [], lastTime: since, lastSeen: null }
}

/** The hold after one more frame. */
export function holdStance(hold: StanceHold, frame: StanceFrame): StanceHold {
  const { dropoutMs, settleMs, stillWindowMs } = STANCE_HOLD_RULES
  const elapsed = Math.min(Math.max(0, frame.time - hold.lastTime), dropoutMs)
  const seen = frame.grip !== null && frame.shoulderWidth !== null
  const kept = hold.recent.filter((sample) => frame.time - sample.time <= stillWindowMs)
  const recent = frame.grip ? [...kept, { time: frame.time, grip: frame.grip }] : kept
  const settled = frame.time - hold.since >= settleMs
  const holding = hold.armed && settled && frame.inStance && isStill(recent, frame.shoulderWidth)
  const lostBriefly = !seen && hold.lastSeen !== null && frame.time - hold.lastSeen <= dropoutMs
  return {
    ...hold,
    armed: hold.armed || (seen && !frame.inStance),
    heldMs: nextHeldMs(hold.heldMs, elapsed, holding, lostBriefly),
    recent,
    lastTime: frame.time,
    lastSeen: seen ? frame.time : hold.lastSeen,
  }
}

/** The held time after `elapsed` ms more: up while holding, kept through a brief dropout, else down; full stays. */
export function nextHeldMs(heldMs: number, elapsed: number, holding: boolean, lostBriefly: boolean) {
  const { holdMs, drainRate } = STANCE_HOLD_RULES
  if (heldMs >= holdMs || lostBriefly) return heldMs
  if (holding) return Math.min(holdMs, heldMs + elapsed)
  return Math.max(0, heldMs - elapsed * drainRate)
}

/** Whether the grips in `recent` all stay near their middle, for a visitor `shoulderWidth` wide. */
export function isStill(recent: readonly { grip: Point }[], shoulderWidth: number | null) {
  if (shoulderWidth === null || recent.length === 0) return false
  const middle = meanPoint(recent.map((sample) => sample.grip))
  const reach = STANCE_HOLD_RULES.stillShoulderWidths * shoulderWidth
  return recent.every((sample) => distance(sample.grip, middle) <= reach)
}

/** How full the gauge is, 0..1. */
export function stanceProgress(hold: StanceHold | null) {
  return hold ? hold.heldMs / STANCE_HOLD_RULES.holdMs : 0
}

export function stanceHeld(hold: StanceHold | null) {
  return hold !== null && hold.heldMs >= STANCE_HOLD_RULES.holdMs
}

/**
 * The hold after `frame`: none while no step waits (`wait` null), a new one from this frame when the step that waits
 * is a new one, otherwise this one, followed.
 */
export function followStance(hold: StanceHold | null, wait: string | null, frame: StanceFrame): StanceHold | null {
  if (wait === null) return null
  const current = hold?.wait === wait ? hold : startStanceHold(wait, frame.time)
  return holdStance(current, frame)
}

/**
 * The stance hold the page waits for: `wait` names the step that waits (derbyFlow.ts stanceWait), or is null while
 * none does; `onProgress` hears how full the gauge is (0..1) whenever that changes, and `onHeld` once when it fills.
 */
export type StanceWatch = { wait: string | null; onProgress: (progress: number) => void; onHeld: () => void }

/**
 * The hold after one more frame, reported to `stance`: its progress when that changed from `shownProgress`, and the
 * moment it fills, once for each wait, though a full hold stays full until the next step comes. Returns the hold,
 * which holds only while the camera is `timed` (ready to play).
 */
export function watchStance(
  hold: StanceHold | null,
  timed: boolean,
  frame: StanceFrame,
  stance: StanceWatch,
  shownProgress: number,
) {
  const next = followStance(hold, timed ? stance.wait : null, frame)
  const progress = stanceProgress(next)
  if (progress !== shownProgress) stance.onProgress(progress)
  const heldAlready = stanceHeld(hold) && hold?.wait === next?.wait
  if (stanceHeld(next) && !heldAlready) stance.onHeld()
  return next
}
