import { damp } from '../../motionMath'
import { HELD_OBJECT_RULES } from '../vision/heldObject'
import {
  type BodySample,
  distance,
  followedWrists,
  type Hand,
  meanPoint,
  pictureEdgeDistance,
  type Point,
  type ShoulderLine,
} from '../vision/poseLandmarks'
import { CAPTION_HOLD_MS, type Side, SWING_RULES, type SwingTracker, type TrackerView } from '../vision/swingTracker'

// The hands-free way on: holding the batting stance about three seconds starts practice, the run after it, and another
// run, the way camera games start on a held pose. The stance is read straight from the pose, not from the swing
// tracker's states, once it has locked what the visitor swings (an object, or the hands): the grip it follows (both
// hands together, or the one hand that holds the object) inside the picture, behind the body's midline on the batting
// side as far as the tracker loads, up by the chest or shoulders, and held still. A wrist at the picture's edge or past
// it is one the pose task only guesses, so the hands in view come before any height or place (right after swings,
// hands at the edge are lowered ones, so the line asks for them raised). Hands-only mode follows both wrists, as its
// swings do, so it wants both hands together. Stillness is the grip, smoothed, staying near its middle, so the pose
// task's jitter on a still visitor does not count as moving. Lengths are the visitor's own shoulder widths (SW), so
// they mean the same near the camera and far from it. None counts in a step's first second, whose line says the stance
// is being checked rather than to keep holding a gauge that does not move. On the setup a visitor already in the
// stance fills the gauge; right after swings, a stance kept from the last one counts only once the visitor has been
// seen out of it (moving, or lowering their hands) for longer than `graceMs`, so a glitch of the pose task does not
// count as a fresh stance. A break or a tracking loss that short neither fills nor drains the gauge; a longer one
// drains it as fast as holding fills it, and a full gauge stays full. Times are the camera frames' capture times (ms).

/**
 * Checked against the drafts' one real webcam log (2026-10-31-real-webcam-1.json): over 500 ms of a visitor holding
 * still, the raw grip strays up to 0.31 SW from its middle, smoothed over 150 ms up to 0.18 SW; raising or lowering the
 * hands moves it a shoulder width or more.
 */
export const STANCE_HOLD_RULES = {
  holdMs: 3000,
  /** How long after a step asks for the stance that none counts. */
  settleMs: 1000,
  /** A followed wrist nearer the picture's edge than this (image heights), or past it, is not in view. */
  edgeMargin: 0.05,
  /** A break in the stance, or a tracking loss, this short (ms) neither fills nor drains the gauge. */
  graceMs: 300,
  /**
   * The grip is up by the back shoulder this far behind the midline at least, where the swing tracker loads, so a
   * stance that counts is one it swings from, and at most `lowestGrip` below it.
   */
  behindMidline: SWING_RULES.loadOffset,
  lowestGrip: 1,
  /** The grip is smoothed with this time constant (ms) before stillness is measured. */
  smoothingMs: 150,
  /** The grip is still while every smoothed grip of the last `stillWindowMs` stays this near their middle. */
  stillShoulderWidths: 0.3,
  stillWindowMs: 500,
}

/**
 * What the hold waits for, first unmet first (i18n `baseball.flow.needs`): the upper body in view, the hands inside
 * the picture, the swing tracker's lock on what the visitor swings, the hands together, the grip raised by the back
 * shoulder, a stance taken afresh after swings, a still one, the step's first second (`settle`); `hold` once it holds.
 */
export type StanceNeed = 'show' | 'handsInView' | 'lock' | 'together' | 'raise' | 'retake' | 'still' | 'settle' | 'hold'

/** What a pose by itself lacks of the stance. */
export type PoseNeed = Extract<StanceNeed, 'show' | 'handsInView' | 'lock' | 'together' | 'raise'>

/**
 * One camera frame as the hold reads it: what the pose lacks of the stance (null for nothing), and the grip and the
 * visitor's shoulder width (image units) that tell stillness, both null when the camera lost them.
 */
export type StanceFrame = { time: number; pose: PoseNeed | null; grip: Point | null; shoulderWidth: number | null }

/**
 * What the page waits for (derbyFlow.ts stanceWait): a key that is new for each step that waits, and whether the step
 * comes right after swings, where the visitor may still stand in the stance of the last one.
 */
export type StanceWait = { key: string; afterSwings: boolean }

export type GripSample = { time: number; grip: Point }

/**
 * A hold for the step `key` names, asked for at `since`, right after swings or not: whether a stance counts yet
 * (`armed`), since when the visitor has been seen out of the stance (null while in it or unseen), how long it has been
 * held, the grip's recent smoothed samples that tell stillness, when the last frame came and when it last held, and
 * what it waits for as of that frame.
 */
export type StanceHold = {
  key: string
  since: number
  afterSwings: boolean
  armed: boolean
  outSince: number | null
  heldMs: number
  recent: GripSample[]
  lastTime: number
  lastHeldAt: number | null
  need: StanceNeed
}

/**
 * The frame's stance as the pose shows it, against the shoulders the swing tracker measured from frontal frames: the
 * grip the tracker follows, which is lost (`show`) while the tracker only holds it where it was last seen.
 */
export function stanceFrame(tracker: SwingTracker, time: number): StanceFrame {
  const { view } = tracker
  const shoulders = tracker.frame.frontal
  if (!view || view.source === 'hold' || !shoulders) return { time, pose: 'show', grip: null, shoulderWidth: null }
  return { time, pose: trackedPoseNeed(tracker, view, shoulders), grip: view.grip, shoulderWidth: shoulders.width }
}

/**
 * What the tracked pose lacks of the stance: the hands the grip follows inside the picture first, since every other
 * reading of a guessed wrist is a guess too; then, until the tracker has locked what the visitor swings, the lock, as
 * it could not follow a swing yet; then the stance itself.
 */
export function trackedPoseNeed(tracker: SwingTracker, view: TrackerView, shoulders: ShoulderLine): PoseNeed | null {
  if (handsAtEdge(view.wrists, tracker.hand, tracker.aspect)) return 'handsInView'
  if (tracker.state === 'searching') return 'lock'
  return poseNeed(view, shoulders, tracker.side, tracker.hand)
}

/** How far inside the picture's edge the followed wrist nearest it is (image heights); null with none showing. */
export function handsEdgeDistance(wrists: BodySample['wrists'], hand: Hand, aspect: number) {
  const distances = followedWrists(wrists, hand).map((wrist) => pictureEdgeDistance(wrist, aspect))
  return distances.length > 0 ? Math.min(...distances) : null
}

/** Whether a followed wrist is near the picture's edge or past it, where the pose task only guesses where it is. */
export function handsAtEdge(wrists: BodySample['wrists'], hand: Hand, aspect: number) {
  const edge = handsEdgeDistance(wrists, hand, aspect)
  return edge !== null && edge < STANCE_HOLD_RULES.edgeMargin
}

/**
 * What the pose lacks of the stance, batting on `side` with the object in `hand`: both hands together when both hold
 * it (a hidden one is taken to be on the other), then the grip up by the back shoulder.
 */
export function poseNeed(
  view: Pick<TrackerView, 'wrists' | 'grip'>,
  shoulders: ShoulderLine,
  side: Side,
  hand: Hand,
): PoseNeed | null {
  if (hand === 'both' && handsApart(view.wrists, shoulders.width)) return 'together'
  return gripRaised(view.grip, shoulders, side) ? null : 'raise'
}

/** Whether both wrists show, farther apart than two hands holding one thing. */
export function handsApart({ left, right }: BodySample['wrists'], shoulderWidth: number) {
  return left !== null && right !== null && distance(left, right) > HELD_OBJECT_RULES.twoHands * shoulderWidth
}

/** How far (SW) `grip` is behind the midline toward the shoulder on the batting `side`. */
export function gripDepth(grip: Point, shoulders: ShoulderLine, side: Side) {
  return ((grip.x - shoulders.midX) / shoulders.width) * side
}

/** How far (SW) `grip` hangs below the shoulders. */
export function gripDrop(grip: Point, shoulders: ShoulderLine) {
  return (grip.y - shoulders.midY) / shoulders.width
}

/** Whether `grip` is up by the back shoulder: behind the midline on the batting side, and no lower than the chest. */
export function gripRaised(grip: Point, shoulders: ShoulderLine, side: Side) {
  const { behindMidline, lowestGrip } = STANCE_HOLD_RULES
  return gripDepth(grip, shoulders, side) >= behindMidline && gripDrop(grip, shoulders) <= lowestGrip
}

/** Whether the step that asked for `hold` has waited long enough, by `time`, for a stance to count. */
export function stanceSettled(hold: Pick<StanceHold, 'since'>, time: number) {
  return time - hold.since >= STANCE_HOLD_RULES.settleMs
}

/** A hold for `wait`, asked for at `since`: armed at once, unless the step comes right after swings. */
export function startStanceHold(wait: StanceWait, since: number): StanceHold {
  return {
    key: wait.key,
    since,
    afterSwings: wait.afterSwings,
    armed: !wait.afterSwings,
    outSince: null,
    heldMs: 0,
    recent: [],
    lastTime: since,
    lastHeldAt: null,
    need: 'show',
  }
}

/** The hold after one more frame. */
export function holdStance(hold: StanceHold, frame: StanceFrame): StanceHold {
  const { graceMs, stillWindowMs } = STANCE_HOLD_RULES
  const elapsed = Math.min(Math.max(0, frame.time - hold.lastTime), graceMs)
  const smoothed = frame.grip && smoothGrip(hold.recent.at(-1) ?? null, { time: frame.time, grip: frame.grip })
  const kept = hold.recent.filter((sample) => frame.time - sample.time <= stillWindowMs)
  const recent = smoothed ? [...kept, smoothed] : kept
  const still = isStill(recent, frame.shoulderWidth)
  const outSince = outOfStance(frame, still) ? (hold.outSince ?? frame.time) : null
  const armed = hold.armed || (outSince !== null && frame.time - outSince > graceMs)
  const holding = armed && stanceSettled(hold, frame.time) && frame.pose === null && still
  const graced = !holding && hold.lastHeldAt !== null && frame.time - hold.lastHeldAt <= graceMs
  return {
    ...hold,
    armed,
    outSince,
    heldMs: nextHeldMs(hold.heldMs, elapsed, holding, graced),
    recent,
    lastTime: frame.time,
    lastHeldAt: holding ? frame.time : hold.lastHeldAt,
    need: holding || graced ? 'hold' : unmetNeed(frame.pose, { afterSwings: hold.afterSwings, armed }, still),
  }
}

/** `sample` smoothed after `previous`, by how long (ms) has passed since it, so it is the same at any frame rate. */
export function smoothGrip(previous: GripSample | null, sample: GripSample): GripSample {
  if (!previous) return sample
  const rate = 1 / STANCE_HOLD_RULES.smoothingMs
  const elapsed = Math.max(0, sample.time - previous.time)
  const grip = {
    x: damp(previous.grip.x, sample.grip.x, rate, elapsed),
    y: damp(previous.grip.y, sample.grip.y, rate, elapsed),
  }
  return { time: sample.time, grip }
}

/** Whether a frame shows the visitor out of the stance: hands apart or down, or on the move. */
export function outOfStance(frame: StanceFrame, still: boolean) {
  return frame.pose !== 'show' && (frame.pose !== null || !still)
}

/**
 * The first thing a frame that does not hold lacks: from the pose, a fresh stance, stillness, and with all of them,
 * only the step's first second to pass. Right after swings the visitor was just seen swinging, so hands at the
 * picture's edge are most likely the lowered ones a fresh stance starts from (a webcam framed from the head down sees
 * lowered hands at its bottom edge): the line asks for the fresh stance and then for the hands raised, not to step back.
 */
export function unmetNeed(
  pose: PoseNeed | null,
  { afterSwings, armed }: Pick<StanceHold, 'afterSwings' | 'armed'>,
  still: boolean,
): StanceNeed {
  if (pose === 'handsInView' && afterSwings) return armed ? 'raise' : 'retake'
  if (pose) return pose
  if (!armed) return 'retake'
  return still ? 'settle' : 'still'
}

/** The held time after `elapsed` ms more: up while holding, kept through a brief break, else down; full stays. */
export function nextHeldMs(heldMs: number, elapsed: number, holding: boolean, graced: boolean) {
  const { holdMs } = STANCE_HOLD_RULES
  if (heldMs >= holdMs || graced) return heldMs
  if (holding) return Math.min(holdMs, heldMs + elapsed)
  return Math.max(0, heldMs - elapsed)
}

/** Whether the grips in `recent` all stay near their middle, for a visitor `shoulderWidth` wide. */
export function isStill(recent: readonly GripSample[], shoulderWidth: number | null) {
  const spread = stillSpread(recent, shoulderWidth)
  return spread !== null && spread <= STANCE_HOLD_RULES.stillShoulderWidths
}

/** The farthest any grip in `recent` strays from their middle (SW); null with no grip or no width. */
export function stillSpread(recent: readonly GripSample[], shoulderWidth: number | null) {
  if (shoulderWidth === null || recent.length === 0) return null
  const middle = meanPoint(recent.map((sample) => sample.grip))
  return Math.max(...recent.map((sample) => distance(sample.grip, middle))) / shoulderWidth
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
export function followStance(hold: StanceHold | null, wait: StanceWait | null, frame: StanceFrame) {
  if (wait === null) return null
  const current = hold?.key === wait.key ? hold : startStanceHold(wait, frame.time)
  return holdStance(current, frame)
}

/**
 * The stance hold the page waits for: `wait` says what the step that waits wants, or is null while none does;
 * `onProgress` hears how full the gauge is (0..1) whenever that changes, and `onHeld` once when it fills.
 */
export type StanceWatch = { wait: StanceWait | null; onProgress: (progress: number) => void; onHeld: () => void }

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
  const heldAlready = stanceHeld(hold) && hold?.key === next?.key
  if (stanceHeld(next) && !heldAlready) stance.onHeld()
  return next
}

/** What the gauge's line says the hold waits for, and since when (ms). */
export type ShownNeed = { need: StanceNeed; since: number }

/**
 * The line after a frame at `time` whose hold waits for `wanted` (null while no hold runs): another need replaces the
 * one shown only once that has stood CAPTION_HOLD_MS, as the camera's caption does, so the line never flickers.
 */
export function nextShownNeed(shown: ShownNeed | null, wanted: StanceNeed | null, time: number): ShownNeed | null {
  if (wanted === null) return null
  if (shown && (shown.need === wanted || time - shown.since < CAPTION_HOLD_MS)) return shown
  return { need: wanted, since: time }
}
