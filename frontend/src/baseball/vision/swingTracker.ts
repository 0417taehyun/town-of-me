import { type BattingSide, STRIKE_ZONE } from '../game/field'
import { median, percentile } from '../statistics'
import {
  currentBox,
  type Detection,
  freeLock,
  HELD_OBJECT_RULES,
  type HeldObjectLabel,
  type HeldObjectLock,
  isLockedBy,
  lockCandidates,
  lockOn,
  lockProgress,
  manualLock,
  type MeasuredDetection,
  NO_SEARCH,
  refreshLock,
  searchForLock,
  type LockSearch,
} from './heldObject'
import { type Energy, NO_ENERGY } from './motionEnergy'
import {
  type BodySample,
  type Box,
  distance,
  gripOf,
  type Hand,
  minus,
  plus,
  type Point,
  type ShoulderLine,
  visibleWrists,
} from './poseLandmarks'

// The camera swing: searching → locked ⇄ loaded → sweeping → cooldown → locked. The held object is locked once
// (heldObject.ts), by itself: what the detector finds next to the still hands, or after a while with nothing found,
// none (free mode), which a real object that locks still replaces while the visitor sets up. A swing is then the
// grip, loaded behind the body's midline on the batting side, sweeping fast across it while the band it sweeps
// through lights up with motion (motionEnergy.ts). It needs no pause at the load, because batters wind up and swing in
// one motion; it re-arms only once the grip is back on a load side, so the bat coming back is never a second swing.
// The midline is the body's, measured from frontal frames only: turning the torso to load narrows the shoulders and
// drags their midpoint, which would inflate every distance and speed. The contact moment is when the grip crosses that
// midline, between the two frames either side of it. The camera panel's caption says where the tracker is, and for a
// moment what just happened (a lock, a swing, a sweep that was not one); its picture marks the object (objectMark).
//
// Units: lengths in shoulder widths (SW), speeds in SW/s, times in ms on the frames' capture clock, energy as
// motionEnergy.ts measures it. Raw (unmirrored) image, the visitor facing the camera: a right-handed batter's back
// shoulder is on the image's left. The rules come from the drafts' synthetic swings and one real webcam log; they have
// not been tuned against a webcam in this app yet.

export const SWING_RULES = {
  /** Grip speed (smoothed) under which the hands count as still: to lock an object, and for the noise baseline. */
  still: 2.5,
  speedSmoothing: 0.4,
  /** The frontal width is this percentile of the last `frameSamples` widths; frames this share of it are frontal. */
  frontalPercentile: 0.9,
  frontal: 0.6,
  frameSamples: 120,
  /** A wrist hidden behind the turned torso is followed through the other wrist, or held, for this long. */
  bridgeGapMs: 700,
  /** The grip this far behind the midline is loaded; moving `leaveLoad` toward it starts a sweep. */
  loadOffset: 0.25,
  leaveLoad: 0.1,
  /** Travel counts from the deepest point of the load within this long, so a load from long ago cannot pad a flick. */
  deepestMemoryMs: 1500,
  /**
   * A sweep must cross the midline within `crossWithinMs` of leaving the load, and meet every rule within
   * `finishWithinMs` of the crossing. Real swings meet them a few frames after it; the derby waits for a swing this
   * long and more (game/derby.ts LATE_SWING_MARGIN_MS), so lengthening it can lose late swings.
   */
  crossWithinMs: 450,
  finishWithinMs: 150,
  travel: 0.7,
  swingSpeed: 4,
  /** A sweep this long and fast is a swing even if the picture barely changed (a dark room, matching clothes). */
  strongTravel: 1.1,
  strongSpeed: 7,
  /** The head may move at most this share of the grip's travel: when it moves with the hands, the visitor moved. */
  headShare: 0.5,
  /** A grip lost mid-sweep still swings if it was closing on the midline this fast and would cross within the horizon. */
  fastBeforeLoss: 3,
  dropoutWindowMs: 150,
  dropoutTravel: 0.4,
  dropoutHorizonMs: 200,
  predictedCrossingCapMs: 300,
  /** The band must change `energyRatio` times its resting noise (at least `energyFloor`) over `energyArea` of it. */
  energyRatio: 2,
  energyFloor: 1.5,
  energyArea: 0.03,
  baselineLearning: 0.15,
  /** How long after a swing until the tracker re-arms. */
  cooldownMs: 400,
}

/**
 * Where the grip crossed the midline, against the visitor's own shoulders, gives the bat's height on the field: a grip
 * `levelDrop` shoulder widths below the shoulders swings level through the strike zone's middle, and each shoulder
 * width higher or lower moves the bat `metersPerShoulderWidth` (the town character's zone is 0.5 m tall). Not yet
 * tuned against a real webcam.
 */
export const CONTACT_HEIGHT = { levelDrop: 1.1, metersPerShoulderWidth: 0.3 }

export type TrackerState = 'searching' | 'locked' | 'loaded' | 'sweeping' | 'cooldown'

/**
 * What the camera panel's caption says (i18n `camera.tracker`): where the tracker is, or a notice of what just
 * happened (a lock, free mode, a lost object, a tap it could not use, a swing, a sweep that was not one).
 */
export type TrackerReason =
  | 'showHands'
  | 'looking'
  | 'holdStill'
  | 'locking'
  | 'locked'
  | 'free'
  | 'lost'
  | 'tapNearHands'
  | 'pullBack'
  | 'otherSide'
  | 'loaded'
  | 'swing'
  | 'swingThrough'
  | 'faster'
  | 'bigger'
  | 'unclear'
  | 'stayPut'

/** A notice, numbered so the caption shows each once (nextCaption). */
export type TrackerNotice = { reason: TrackerReason; serial: number }

/** -1: the image's left, a right-handed batter's back shoulder; 1: the right, a left-handed one's. */
export type Side = -1 | 1

/** What a grip point is made of: one wrist, both averaged, a hidden wrist bridged by the other, or a grip held. */
export type GripSource = Hand | 'bridge' | 'hold'

/** The shoulders measured from frontal frames only (withShoulders), null until both shoulders have shown. */
export type BodyFrame = { samples: ShoulderLine[]; frontal: ShoulderLine | null }

/** The body as the tracker measures it: the grip in the frozen frame, with the head when it shows. */
export type TrackerView = {
  wrists: BodySample['wrists']
  head: Point | null
  grip: Point
  source: GripSource
  width: number
  midX: number
}

/** The grip as last seen, and its offset from each wrist then, to follow it through the other wrist when one hides. */
export type LastGrip = { point: Point; time: number; fromLeft: Point | null; fromRight: Point | null }

/** A load `depth` SW behind the midline on `side`, as of `time`, and the deepest it has been lately. */
export type Arm = {
  side: Side
  depth: number
  time: number
  grip: Point
  deepest: { depth: number; grip: Point; time: number }
}

/** A sweep from a load toward the midline and across it: what has been measured of it so far. */
export type Sweep = {
  arm: Arm
  startedAt: number
  from: Point
  head: Point | null
  startDepth: number
  previousDepth: number
  previousTime: number
  lastGrip: Point
  crossTime: number | null
  crossY: number | null
  minimumDepth: number
  travel: number
  headShift: number
  peak: number
  velocity: number
  energy: number
  moving: number
}

export type SweepFailure = 'cross' | 'speed' | 'travel' | 'energy' | 'body'

/** The best object a detector run found next to the hands: when, and where the grip was then. */
export type Candidate = MeasuredDetection & { seenAt: number; grip: Point }

/**
 * `settingUp` says the visitor is on the setup step (the page's), where a real object that locks replaces free mode.
 * `candidate` is the best object the detector lately found next to the hands, `search` the sightings toward its lock,
 * and `searchSince` when the detector first looked at the hands with nothing locked. `reason` is where the tracker is
 * and `notice` the latest thing that happened; `followingThrough` says the grip is on its way out of a swing toward the
 * far side, where its finish is no wrong-side load.
 */
export type SwingTracker = {
  state: TrackerState
  settingUp: boolean
  side: Side
  hand: Hand
  frame: BodyFrame
  aspect: number
  view: TrackerView | null
  lastGrip: LastGrip | null
  lock: HeldObjectLock | null
  candidate: Candidate | null
  search: LockSearch
  searchSince: number | null
  reason: TrackerReason | null
  notice: TrackerNotice | null
  followingThrough: boolean
  last: { grip: Point; source: GripSource; time: number } | null
  speed: number
  smoothedSpeed: number
  arm: Arm | null
  sweep: Sweep | null
  baseline: number | null
  energy: Energy
  band: Box | null
  cooldownUntil: number
}

/** One camera frame for the tracker: its capture time, the body, the detector's finds if it ran, and the motion. */
export type TrackerFrame = { time: number; body: BodySample | null; detections: Detection[] | null; energy: Energy }

/**
 * A swing: when the grip crossed the midline (the contact moment) and when it left the load, its top speed (SW/s), and
 * the bat's height (field m) where it crossed, or null when tracking lost the grip before it got there.
 */
export type TrackedSwing = { contactAtMs: number; startedAtMs: number; speed: number; batHeight: number | null }

export const NO_BODY_FRAME: BodyFrame = { samples: [], frontal: null }

const NO_WRISTS: BodySample['wrists'] = { left: null, right: null }

export function loadSide(battingSide: BattingSide): Side {
  return battingSide === 'left' ? 1 : -1
}

export function createSwingTracker(battingSide: BattingSide): SwingTracker {
  return {
    state: 'searching',
    settingUp: false,
    side: loadSide(battingSide),
    hand: 'both',
    frame: NO_BODY_FRAME,
    aspect: 4 / 3,
    view: null,
    lastGrip: null,
    lock: null,
    candidate: null,
    search: NO_SEARCH,
    searchSince: null,
    reason: null,
    notice: null,
    followingThrough: false,
    last: null,
    speed: 0,
    smoothedSpeed: 0,
    arm: null,
    sweep: null,
    baseline: null,
    energy: NO_ENERGY,
    band: null,
    cooldownUntil: -Infinity,
  }
}

/** Forgets a lost object, keeping the step, batting side, body frame, noise, and the caption's latest notice. */
export function resetLock(tracker: SwingTracker) {
  const { settingUp, side, frame, aspect, baseline, notice } = tracker
  // A fresh tracker in every other respect, with its batting side put back.
  Object.assign(tracker, createSwingTracker('right'), { settingUp, side, frame, aspect, baseline, notice })
}

/** Forgets everything the camera showed (it turned off), keeping only the step and the batting side. */
export function forgetCamera(tracker: SwingTracker) {
  const { settingUp, side } = tracker
  Object.assign(tracker, createSwingTracker('right'), { settingUp, side })
}

/** Tells the caption what just happened. */
export function notify(tracker: SwingTracker, reason: TrackerReason) {
  tracker.notice = { reason, serial: (tracker.notice?.serial ?? 0) + 1 }
}

export function setTrackerSide(tracker: SwingTracker, battingSide: BattingSide) {
  tracker.side = loadSide(battingSide)
}

/**
 * Feeds one camera frame and returns the swing it completed, if any. `energy` is measured in the band the previous
 * frame left in `tracker.band`; `detections` come only on frames the object detector ran.
 */
export function updateSwingTracker(
  tracker: SwingTracker,
  { time, body, detections, energy }: TrackerFrame,
): TrackedSwing | null {
  tracker.energy = energy
  if (body) tracker.aspect = body.aspect
  if (body?.shoulders) tracker.frame = withShoulders(tracker.frame, body.shoulders)
  const view = viewOf(tracker, body, time)
  tracker.view = view
  // What the detector found by the hands is gone with them, or once no run has seen it lately (the detector rests
  // through a pitch), rather than left marked and waited for where it was.
  if (!view || !isFresh(tracker.candidate, time)) tracker.candidate = null
  trackMotion(tracker, view, time)
  // The noise only learns while nobody is mid-swing, or a slow stretch of a swing would raise its own bar.
  if (isResting(tracker, view)) learnNoise(tracker)
  if (detections && view) readDetections(tracker, detections, view, time)
  const swing = TRACKER_STEPS[tracker.state](tracker, view, time)
  tracker.band = swingBand(tracker, tracker.view)
  return swing
}

/**
 * The frame after one more frame's shoulders. Rotation only ever narrows them, so the frontal width is a high
 * percentile of recent widths, and only frames near it give the width and the midline.
 */
export function withShoulders(frame: BodyFrame, shoulders: ShoulderLine): BodyFrame {
  const samples = [...frame.samples, shoulders].slice(-SWING_RULES.frameSamples)
  const frontalWidth = percentile(
    samples.map((sample) => sample.width),
    SWING_RULES.frontalPercentile,
  )
  const frontal = samples.filter((sample) => sample.width >= SWING_RULES.frontal * frontalWidth)
  return {
    samples,
    frontal: {
      width: median(frontal.map((sample) => sample.width)),
      midX: median(frontal.map((sample) => sample.midX)),
      midY: median(frontal.map((sample) => sample.midY)),
    },
  }
}

/**
 * The body in the frozen frame, following the holding hand. When that wrist hides behind the turned torso, the grip
 * follows the other wrist at their last offset (`bridge`), or stays where it was last seen (`hold`, which a sweep
 * treats as lost), for up to `bridgeGapMs`.
 */
export function viewOf(tracker: SwingTracker, body: BodySample | null, time: number): TrackerView | null {
  const frontal = tracker.frame.frontal
  if (!frontal) return null
  const wrists = body?.wrists ?? NO_WRISTS
  const base = { wrists, head: body?.head ?? null, width: frontal.width, midX: frontal.midX }
  const grip = gripOf(wrists, tracker.hand)
  if (!grip) return bridgedView(tracker.lastGrip, base, time)
  tracker.lastGrip = {
    point: grip.point,
    time,
    fromLeft: wrists.left && minus(grip.point, wrists.left),
    fromRight: wrists.right && minus(grip.point, wrists.right),
  }
  return { ...base, grip: grip.point, source: grip.source }
}

export function bridgedView(
  last: LastGrip | null,
  base: Omit<TrackerView, 'grip' | 'source'>,
  time: number,
): TrackerView | null {
  if (!last || time - last.time > SWING_RULES.bridgeGapMs) return null
  const { left, right } = base.wrists
  if (left && last.fromLeft) return { ...base, grip: plus(left, last.fromLeft), source: 'bridge' }
  if (right && last.fromRight) return { ...base, grip: plus(right, last.fromRight), source: 'bridge' }
  return { ...base, grip: last.point, source: 'hold' }
}

/** The grip's speed since the last frame; never across a gap or a change of what the grip is made of. */
export function trackMotion(tracker: SwingTracker, view: TrackerView | null, time: number) {
  const previous = tracker.last
  tracker.last = view && view.source !== 'hold' ? { grip: view.grip, source: view.source, time } : null
  if (!view || !tracker.last || !previous || previous.source !== view.source || time <= previous.time) {
    tracker.speed = 0
    return
  }
  tracker.speed = distance(view.grip, previous.grip) / view.width / ((time - previous.time) / 1000)
  tracker.smoothedSpeed += (tracker.speed - tracker.smoothedSpeed) * SWING_RULES.speedSmoothing
}

export function isStill(tracker: SwingTracker, view: TrackerView | null) {
  return view !== null && view.source !== 'hold' && tracker.smoothedSpeed < SWING_RULES.still
}

export function isResting(tracker: SwingTracker, view: TrackerView | null) {
  const resting = tracker.state === 'searching' || tracker.state === 'locked' || tracker.state === 'loaded'
  return resting && isStill(tracker, view)
}

export function learnNoise(tracker: SwingTracker) {
  const { value } = tracker.energy
  const learning = SWING_RULES.baselineLearning
  tracker.baseline = tracker.baseline === null ? value : tracker.baseline * (1 - learning) + value * learning
}

/**
 * A detector run: while the tracker looks for an object, the best one next to the still hands builds a lock; once a
 * detected object is locked, refreshes it.
 */
export function readDetections(
  tracker: SwingTracker,
  detections: readonly Detection[],
  view: TrackerView,
  time: number,
) {
  const candidates = lockCandidates(detections, view, tracker.aspect)
  const best = candidates.at(0)
  tracker.candidate = best ? { ...best, seenAt: time, grip: view.grip } : null
  if (tracker.state === 'searching') return searchWith(tracker, view, time)
  if (standsInForObject(tracker)) return sightCandidate(tracker, view, time)
  refreshHeldObject(tracker, candidates, view, time)
}

/** Whether `candidate` was seen by a detector run lately enough, by `time`, to be by the hands still. */
export function isFresh(candidate: Candidate | null, time: number) {
  return candidate !== null && time - candidate.seenAt <= HELD_OBJECT_RULES.candidateFreshMs
}

/** A detector run while searching: it starts the clock that runs out to free mode, and sights the candidate. */
export function searchWith(tracker: SwingTracker, view: TrackerView, time: number) {
  tracker.searchSince ??= time
  sightCandidate(tracker, view, time)
}

/**
 * The caption while searching: looking, while nothing is by the hands and the search has time left; otherwise the
 * hands must keep still, for what is by them to lock or, with nothing there, for free mode to start.
 */
export function searchReason(found: boolean, ranOut: boolean, still: boolean): TrackerReason {
  if (!found && !ranOut) return 'looking'
  return still ? 'locking' : 'holdStill'
}

/** The best candidate next to the still hands, sighted toward its lock: enough sightings of one place lock it. */
export function sightCandidate(tracker: SwingTracker, view: TrackerView, time: number) {
  const best = tracker.candidate
  if (!best || !isStill(tracker, view)) return
  tracker.search = searchForLock(tracker.search, best.imageBox, time)
  if (!isLockedBy(tracker.search)) return
  lockTracker(tracker, { ...lockOn(view, best.imageBox, 'detected'), label: best.label })
}

/** Whether free mode stands in for an object while the visitor sets up, so a real one that locks may replace it. */
export function standsInForObject(tracker: SwingTracker) {
  return tracker.settingUp && tracker.lock?.kind === 'free'
}

/** Whether the tracker looks for an object to lock: searching, or standing in for one while the visitor sets up. */
export function isLookingForObject(tracker: SwingTracker) {
  return tracker.state === 'searching' || standsInForObject(tracker)
}

export function refreshHeldObject(
  tracker: SwingTracker,
  candidates: readonly MeasuredDetection[],
  view: TrackerView,
  time: number,
) {
  const lock = tracker.lock
  if (!lock || lock.kind !== 'detected') return
  // Only a still visitor's object counts as gone: mid-swing blur and pauses are expected misses.
  const watching = (tracker.state === 'locked' || tracker.state === 'loaded') && isStill(tracker, view)
  const refreshed = refreshLock(lock, candidates, view, time, watching)
  tracker.lock = refreshed
  if (refreshed) return
  // Setting up, the hands take over at once, so a stance held while the detector lost the object goes on.
  if (tracker.settingUp) return lockTracker(tracker, freeLock(view))
  resetLock(tracker)
  notify(tracker, 'lost')
}

export function lockTracker(tracker: SwingTracker, lock: HeldObjectLock) {
  Object.assign(tracker, {
    state: 'locked',
    lock,
    hand: lock.hand,
    arm: null,
    sweep: null,
    search: NO_SEARCH,
    searchSince: null,
    last: null,
    lastGrip: null,
    reason: 'pullBack',
    followingThrough: false,
  } satisfies Partial<SwingTracker>)
  notify(tracker, lock.kind === 'free' ? 'free' : 'locked')
}

/**
 * Locks what the visitor tapped on the camera picture: `point` (image units) near their hands, or the thing in their
 * hands when it is on them. Says why when it cannot.
 */
export function lockByHand(tracker: SwingTracker, point: Point) {
  const view = tracker.view
  const lock = view && manualLock(view, point)
  if (lock) return lockTracker(tracker, lock)
  notify(tracker, view && visibleWrists(view.wrists).length > 0 ? 'tapNearHands' : 'showHands')
}

export type TrackerStep = (tracker: SwingTracker, view: TrackerView | null, time: number) => TrackedSwing | null

/**
 * Searching: asks for the hands, and once the detector has looked at them for `handsOnlyAfterMs` with nothing locked,
 * plays free mode from the next moment they are still with nothing by them. The clock starts at the detector's first
 * look (searchWith), so it waits while the detector rests, and starts again once the tracker has lost the hands.
 */
export function stepSearching(tracker: SwingTracker, view: TrackerView | null, time: number) {
  if (!view) tracker.searchSince = null
  if (!view || visibleWrists(view.wrists).length === 0) {
    tracker.reason = 'showHands'
    return null
  }
  tracker.reason = searchReason(tracker.candidate !== null, searchRanOut(tracker, time), isStill(tracker, view))
  if (handsOnlyDue(tracker, view, time)) lockTracker(tracker, freeLock(view))
  return null
}

/** Whether the detector has looked at the hands for `handsOnlyAfterMs` by `time` with nothing locked. */
export function searchRanOut(tracker: SwingTracker, time: number) {
  const since = tracker.searchSince
  return since !== null && time - since >= HELD_OBJECT_RULES.handsOnlyAfterMs
}

/**
 * Whether a search goes on in free mode by `time`: it ran out, and the hands are still with nothing by them, since an
 * object that showed up late (or while the hands moved) would lose its sightings to free mode on the verge of a lock.
 */
export function handsOnlyDue(tracker: SwingTracker, view: TrackerView, time: number) {
  return searchRanOut(tracker, time) && tracker.candidate === null && isStill(tracker, view)
}

/**
 * Locked or loaded: follows the grip against the frozen midline. Reaching `loadOffset` to one side arms a sweep from
 * that side at once, at any speed, and a step back toward the midline starts it. 'loaded' says the grip is armed on
 * the batting side; a swing's finish arms the far side too, so the bat coming back is no swing.
 */
export function stepTracking(tracker: SwingTracker, view: TrackerView | null, time: number) {
  if (!view) {
    disarm(tracker)
    tracker.reason = 'showHands'
    return null
  }
  const offset = (view.grip.x - view.midX) / view.width
  const arm = tracker.arm
  if (!arm) return armIfLoaded(tracker, view, offset, time)
  // A held (unseen) grip is presumed where it was; keep the load's clock current so a sweep starts from now.
  if (view.source === 'hold') {
    arm.time = time
    return null
  }
  const depth = offset * arm.side
  const deeper = depth >= arm.deepest.depth || time - arm.deepest.time > SWING_RULES.deepestMemoryMs
  if (deeper) arm.deepest = { depth, grip: view.grip, time }
  const { leaveLoad, loadOffset } = SWING_RULES
  if (depth >= arm.depth - leaveLoad && depth >= loadOffset - leaveLoad) {
    Object.assign(arm, { depth, time, grip: view.grip })
    return null
  }
  startSweep(tracker, arm, view)
  return stepSweeping(tracker, view, time)
}

export function armIfLoaded(tracker: SwingTracker, view: TrackerView, offset: number, time: number) {
  const neutral = Math.abs(offset) < SWING_RULES.loadOffset
  if (neutral || view.source === 'hold') {
    tracker.state = 'locked'
    tracker.reason = 'pullBack'
    // Back by the body after a swing, so a load on the far side from here is on the wrong side.
    tracker.followingThrough = tracker.followingThrough && !neutral
    return null
  }
  const side: Side = offset < 0 ? -1 : 1
  const depth = offset * side
  tracker.arm = { side, depth, time, grip: view.grip, deepest: { depth, grip: view.grip, time } }
  const batting = side === tracker.side
  tracker.state = batting ? 'loaded' : 'locked'
  tracker.reason = loadReason(batting, tracker.followingThrough)
  tracker.followingThrough = tracker.followingThrough && !batting
  return null
}

/** A new load's words: loaded on the batting side; on the far side, pull back after a swing, else the wrong side. */
export function loadReason(batting: boolean, followingThrough: boolean): TrackerReason {
  if (batting) return 'loaded'
  return followingThrough ? 'pullBack' : 'otherSide'
}

export function disarm(tracker: SwingTracker) {
  Object.assign(tracker, { state: 'locked', arm: null, sweep: null } satisfies Partial<SwingTracker>)
}

export function startSweep(tracker: SwingTracker, arm: Arm, view: TrackerView) {
  tracker.state = 'sweeping'
  tracker.arm = null
  tracker.sweep = {
    arm,
    startedAt: arm.time,
    from: arm.deepest.grip,
    head: view.head,
    startDepth: arm.depth,
    previousDepth: arm.depth,
    previousTime: arm.time,
    lastGrip: arm.grip,
    crossTime: null,
    crossY: null,
    minimumDepth: arm.depth,
    travel: 0,
    headShift: 0,
    peak: 0,
    velocity: 0,
    energy: 0,
    moving: 0,
  }
}

export function stepSweeping(tracker: SwingTracker, view: TrackerView | null, time: number) {
  const sweep = tracker.sweep
  if (!sweep) return null
  sweep.energy = Math.max(sweep.energy, tracker.energy.value)
  sweep.moving = Math.max(sweep.moving, tracker.energy.moving)
  if (!view || view.source === 'hold') return sweepDropout(tracker, sweep, time)
  const depth = ((view.grip.x - view.midX) / view.width) * sweep.arm.side
  // Pose wobble that comes straight back is not a swing: the same load goes on, deepest point and all.
  if (sweep.crossTime === null && depth >= sweep.startDepth) return resumeLoad(tracker, sweep, view, depth, time)
  if (time > sweep.previousTime) sweep.velocity = (depth - sweep.previousDepth) / ((time - sweep.previousTime) / 1000)
  if (sweep.crossTime === null && sweep.previousDepth > 0 && depth <= 0) markCrossing(sweep, view.grip, depth, time)
  sweep.travel = Math.max(sweep.travel, ((sweep.from.x - view.grip.x) * sweep.arm.side) / view.width)
  sweep.headShift = Math.max(sweep.headShift, headShift(sweep, view))
  sweep.peak = Math.max(sweep.peak, tracker.speed)
  sweep.minimumDepth = Math.min(sweep.minimumDepth, depth)
  Object.assign(sweep, { previousDepth: depth, previousTime: time, lastGrip: view.grip })
  if (sweepFailures(tracker, sweep).length === 0) return completeSweep(tracker, sweep, time, sweep.crossY)
  if (sweepIsLate(sweep, time)) abortSweep(tracker, sweep)
  return null
}

/** How far (SW) the head has moved the way the sweep goes since it began; 0 unless the head shows both times. */
export function headShift(sweep: Sweep, view: TrackerView) {
  return sweep.head && view.head ? ((sweep.head.x - view.head.x) * sweep.arm.side) / view.width : 0
}

/** The contact moment: the grip passes the frozen midline, between the capture times either side of it. */
export function markCrossing(sweep: Sweep, grip: Point, depth: number, time: number) {
  const fraction = sweep.previousDepth / (sweep.previousDepth - depth)
  sweep.crossTime = sweep.previousTime + (time - sweep.previousTime) * fraction
  sweep.crossY = sweep.lastGrip.y + (grip.y - sweep.lastGrip.y) * fraction
}

export function resumeLoad(tracker: SwingTracker, sweep: Sweep, view: TrackerView, depth: number, time: number) {
  Object.assign(sweep.arm, { depth, time, grip: view.grip })
  rearm(tracker, sweep.arm)
  return null
}

export function rearm(tracker: SwingTracker, arm: Arm) {
  tracker.arm = arm
  tracker.sweep = null
  tracker.state = arm.side === tracker.side ? 'loaded' : 'locked'
}

/** The rules a sweep has not met yet; none means it is a swing. */
export function sweepFailures(tracker: SwingTracker, sweep: Sweep): SweepFailure[] {
  const strongPose = sweep.travel >= SWING_RULES.strongTravel && sweep.peak >= SWING_RULES.strongSpeed
  const failed: [SweepFailure, boolean][] = [
    ['cross', sweep.crossTime === null],
    ['speed', sweep.peak < SWING_RULES.swingSpeed],
    ['travel', sweep.travel < SWING_RULES.travel],
    ['energy', !energyConfirmed(tracker.baseline, sweep) && !strongPose],
    ['body', movedWithHands(sweep)],
  ]
  return failed.filter(([, failing]) => failing).map(([failure]) => failure)
}

/** Whether the head went along with the hands: the visitor moving (walking past, stepping in), not swinging. */
export function movedWithHands(sweep: Sweep) {
  return sweep.headShift > sweep.travel * SWING_RULES.headShare
}

export function energyConfirmed(baseline: number | null, sweep: Sweep) {
  return sweep.energy >= energyNeeded(baseline) && sweep.moving >= SWING_RULES.energyArea
}

/** The energy a sweep's band must reach: `energyRatio` times its resting noise, which is at least `energyFloor`. */
export function energyNeeded(baseline: number | null) {
  return Math.max(baseline ?? 0, SWING_RULES.energyFloor) * SWING_RULES.energyRatio
}

export function sweepIsLate(sweep: Sweep, time: number) {
  if (sweep.crossTime === null) return time - sweep.startedAt > SWING_RULES.crossWithinMs
  return time - sweep.crossTime > SWING_RULES.finishWithinMs
}

/** What the caption says after a sweep the visitor meant as a swing fails `failure` first. */
export const SWEEP_FAILURE_REASONS = {
  cross: 'swingThrough',
  speed: 'faster',
  travel: 'bigger',
  energy: 'unclear',
  body: 'stayPut',
} satisfies Record<SweepFailure, TrackerReason>

/**
 * Ends a sweep that is not a swing. One that never left the load zone is wobble: the load goes on, as of this frame.
 * One the other way is usually the bat coming back to the load, so it says nothing; one toward the batting side says
 * what to change, and goes on toward the far side like a swing.
 */
export function abortSweep(tracker: SwingTracker, sweep: Sweep) {
  if (!leftLoadZone(sweep)) {
    Object.assign(sweep.arm, { depth: sweep.previousDepth, time: sweep.previousTime, grip: sweep.lastGrip })
    return rearm(tracker, sweep.arm)
  }
  disarm(tracker)
  if (sweep.arm.side !== tracker.side) return
  tracker.followingThrough = true
  notify(tracker, SWEEP_FAILURE_REASONS[sweepFailures(tracker, sweep)[0] ?? 'cross'])
}

/** Whether `sweep` left the load zone on its way, or was only wobble within it. */
export function leftLoadZone(sweep: Sweep) {
  return sweep.minimumDepth < SWING_RULES.loadOffset - SWING_RULES.leaveLoad
}

/**
 * Wrists blurred out mid-sweep: still a swing if the grip was closing on the midline fast when it vanished (not just
 * at some earlier moment), would have crossed it soon, had travelled far enough, and the band lit up. A crossing it
 * did not see is predicted, and the bat's height there is unknown.
 */
export function sweepDropout(tracker: SwingTracker, sweep: Sweep, time: number) {
  if (time - sweep.previousTime > SWING_RULES.dropoutWindowMs) {
    abortSweep(tracker, sweep)
    return null
  }
  const closing = -sweep.velocity
  const fast = closing >= SWING_RULES.fastBeforeLoss
  const crossesSoon = sweep.crossTime !== null || (sweep.previousDepth / closing) * 1000 <= SWING_RULES.dropoutHorizonMs
  const far = sweep.travel >= SWING_RULES.dropoutTravel && !movedWithHands(sweep)
  if (!fast || !crossesSoon || !far || !energyConfirmed(tracker.baseline, sweep)) return null
  sweep.crossTime ??= predictCrossing(sweep)
  return completeSweep(tracker, sweep, time, sweep.crossY)
}

/** When the grip would have reached the midline at its last speed, capped, since it was slowing down or lost. */
export function predictCrossing(sweep: Sweep) {
  if (sweep.previousDepth <= 0 || sweep.velocity >= 0) return sweep.previousTime
  const untilCrossing = (sweep.previousDepth / -sweep.velocity) * 1000
  return sweep.previousTime + Math.min(SWING_RULES.predictedCrossingCapMs, untilCrossing)
}

/**
 * A sweep that met every rule. Toward the batting side it is a swing at the crossing; the other way it is the bat
 * coming back, which a no-pause rule cannot tell from a wrong-side swing, so the batting side decides.
 */
export function completeSweep(
  tracker: SwingTracker,
  sweep: Sweep,
  time: number,
  contactY: number | null,
): TrackedSwing | null {
  if (sweep.arm.side !== tracker.side) {
    disarm(tracker)
    return null
  }
  Object.assign(tracker, {
    state: 'cooldown',
    arm: null,
    sweep: null,
    cooldownUntil: time + SWING_RULES.cooldownMs,
    followingThrough: true,
  } satisfies Partial<SwingTracker>)
  notify(tracker, 'swing')
  return {
    contactAtMs: sweep.crossTime ?? time,
    startedAtMs: sweep.startedAt,
    speed: sweep.peak,
    batHeight: batHeightAt(contactY, tracker.frame.frontal),
  }
}

/** The bat's height on the field (m) for a grip that crossed the midline at image height `contactY`. */
export function batHeightAt(contactY: number | null, shoulders: ShoulderLine | null) {
  if (contactY === null || !shoulders) return null
  const drop = (contactY - shoulders.midY) / shoulders.width
  return STRIKE_ZONE.center + (CONTACT_HEIGHT.levelDrop - drop) * CONTACT_HEIGHT.metersPerShoulderWidth
}

export function stepCooldown(tracker: SwingTracker, _view: TrackerView | null, time: number) {
  if (time >= tracker.cooldownUntil) disarm(tracker)
  return null
}

export const TRACKER_STEPS: Record<TrackerState, TrackerStep> = {
  searching: stepSearching,
  locked: stepTracking,
  loaded: stepTracking,
  sweeping: stepSweeping,
  cooldown: stepCooldown,
}

/**
 * Where motion is measured, as shares of the raw image: the locked box plus the strip the hands and object sweep
 * through, from beyond the load-side grip to past the midline, at grip height ± the object's length. It stays put once
 * a sweep leaves the load, so the noise and the swing are measured over the same pixels.
 */
export function swingBand(tracker: SwingTracker, view: TrackerView | null): Box | null {
  const swinging = tracker.state === 'sweeping' || tracker.state === 'cooldown'
  if (swinging && tracker.band) return tracker.band
  const { lock, aspect } = tracker
  if (!lock || !view) return null
  const length = Math.max(lock.length, 0.5) * view.width
  const side = tracker.arm?.side ?? tracker.side
  const grip = tracker.arm?.deepest.grip ?? view.grip
  const reach = SWING_RULES.travel * view.width + 0.5 * length
  const ends = [grip.x + side * 0.5 * length, view.midX - side * reach]
  const box = currentBox(lock, view.grip)
  const left = Math.max(0, Math.min(...ends, box.x))
  const right = Math.min(aspect, Math.max(...ends, box.x + box.width))
  const top = Math.max(0, Math.min(grip.y - length, box.y))
  const bottom = Math.min(1, Math.max(grip.y + length, box.y + box.height))
  return { x: left / aspect, y: top, width: Math.max(0, right - left) / aspect, height: Math.max(0, bottom - top) }
}

/**
 * What the camera panel marks of the held object (image units): a locked object's box (with what the detector took it
 * for), or while the tracker looks for one, the best candidate the detector lately found next to the hands and how far
 * its lock has come by `time` (0..1). Both move with the hands between detector runs. Null with neither, as in free
 * mode with nothing found.
 */
export type ObjectMark = { box: Box; label: HeldObjectLabel | null; locked: boolean; progress: number }

export function objectMark(tracker: SwingTracker, time: number): ObjectMark | null {
  const { lock, view, candidate } = tracker
  if (isLookingForObject(tracker)) return candidate && candidateMark(tracker, candidate, time)
  if (!lock || lock.kind === 'free') return null
  return { box: view ? currentBox(lock, view.grip) : lock.box, label: lock.label, locked: true, progress: 1 }
}

export function candidateMark(tracker: SwingTracker, candidate: Candidate, time: number): ObjectMark {
  const { imageBox, label, grip } = candidate
  const box = currentBox({ box: imageBox, grip }, tracker.view?.grip ?? grip)
  return { box, label, locked: false, progress: lockProgress(tracker.search, imageBox, time) }
}

/** Where the tracker is now, in the camera panel caption's words. */
export function trackerCaption(tracker: SwingTracker): TrackerReason {
  return tracker.reason ?? 'looking'
}

/** A caption stays at least this long (ms) before the tracker's state replaces it, so it never flickers between two. */
export const CAPTION_HOLD_MS = 700

/** The caption shown, since when (ms), and the serial of the latest notice it has shown (0 for none). */
export type HeldCaption = { caption: TrackerReason; since: number; serial: number }

/**
 * The caption after a frame at `time` (ms): a notice the caption has not shown yet at once, then held like any
 * caption; otherwise the tracker's state, once the caption shown has stood CAPTION_HOLD_MS.
 */
export function nextCaption(shown: HeldCaption | null, tracker: SwingTracker, time: number): HeldCaption {
  const { notice } = tracker
  const serial = notice?.serial ?? 0
  if (notice && serial !== shown?.serial) return { caption: notice.reason, since: time, serial }
  const wanted = trackerCaption(tracker)
  if (shown && (shown.caption === wanted || time - shown.since < CAPTION_HOLD_MS)) return shown
  return { caption: wanted, since: time, serial }
}
