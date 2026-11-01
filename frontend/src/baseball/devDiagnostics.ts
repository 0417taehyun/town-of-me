import type { ObjectDetectorResult } from '@mediapipe/tasks-vision'
import type { CameraTrackingParts } from './cameraTracking'
import {
  gripDrop,
  gripRaised,
  isStill,
  STANCE_HOLD_RULES,
  type StanceFrame,
  type StanceHold,
  stanceSettled,
  stillSpread,
} from './flow/stanceHold'
import type { PitchResult } from './game/derbyScore'
import type { RealTimeSwing, StageEvent } from './stage/stageRun'
import { median } from './statistics'
import { isPlainKey } from './ui/cameraPanelLayout'
import {
  type Detection,
  type HandsView,
  HELD_OBJECT_RULES,
  type HeldObjectLock,
  intersectionOverUnion,
  lockCandidates,
  measureDetection,
  OBJECT_DETECTION_INTERVAL_MS,
  objectDetections,
  toImageBox,
} from './vision/heldObject'
import type { PoseFrame } from './vision/poseLoop'
import {
  energyNeeded,
  type GripSource,
  leftLoadZone,
  type Sweep,
  type SweepFailure,
  sweepFailures,
  SWING_RULES,
  type SwingTracker,
  type TrackerReason,
  type TrackerState,
} from './vision/swingTracker'
import type { VisionTask } from './vision/tasksVision'

// Dev builds only: why the camera game did what it did on a real webcam. Every camera frame leaves a note of how fast
// the camera and the vision tasks run, where the swing tracker and the held object are, and each condition of the
// stance hold; each sweep toward the batting side that left the load leaves one of its timing, from leaving the load
// through the midline crossing to the swing's report and the stage's reaction, against the swing rules, or why it was
// no swing. D shows them in a panel (ui/DiagnosticsPanel.tsx) and L saves the last minute of notes as a JSON file on
// this device, for tuning: numbers and state names only, never a picture, and nothing is sent anywhere.
// cameraTracking.ts and BaseballApp.tsx reach this module only behind `import.meta.env.DEV`, so a production build
// leaves it out. Times are performance.now() ms; lengths are shoulder widths (SW), as in vision/swingTracker.ts.

export const DIAGNOSTICS_WINDOWS = {
  /** The camera's rates and medians are over this long (ms). */
  summaryMs: 2000,
  /** The notes kept, and saved, are this long (ms). */
  logMs: 60000,
  /** How often (ms) the panel redraws while shown. */
  redrawMs: 250,
}

/** The detection nearest to being what the hands hold: its label, its score, and its reach (SW) to a wrist. */
export type CandidateNote = { label: string; score: number; reach: number }

/** The lock, with the label and score of the detection it was last seen as (none for a manual or free lock). */
export type LockNote = { kind: HeldObjectLock['kind']; label: string | null; score: number | null }

/** The grip as the tracker follows it: SW behind the midline toward the batting side's load, below the shoulders. */
export type GripNote = { depth: number; drop: number | null; source: GripSource }

/**
 * Each thing the stance hold needs on a frame, judged by the hold's own rules (flow/stanceHold.ts): the stance as the
 * hold reads it, the grip and shoulders seen, the hold armed, how long since the step asked (ms) and whether that is
 * settled, the tracker loaded on the batting side, the grip's drop below the shoulders and its spread over the
 * stillness window (SW) with whether each passes, and the gauge (ms).
 */
export type StanceNote = {
  inStance: boolean
  seen: boolean
  armed: boolean
  askedMs: number
  settled: boolean
  loaded: boolean
  drop: number | null
  raised: boolean
  spread: number | null
  still: boolean
  heldMs: number
}

/**
 * One camera frame: when the camera took it and the page handled it, how long the pose task and (on frames it ran)
 * the object detector took, and what the tracker, the detector, and the stance hold (null while no step waits) made of it.
 */
export type FrameNote = {
  capturedAt: number
  handledAt: number
  poseMs: number
  objectsMs: number | null
  state: TrackerState
  reason: TrackerReason | null
  lock: LockNote | null
  sightings: number
  candidate: CandidateNote | null
  grip: GripNote | null
  speed: number
  energy: number
  moving: number
  noise: number | null
  stance: StanceNote | null
}

/**
 * A sweep toward the batting side that left the load: a swing, or no swing for its `failures` (the swing rules it had
 * not met when it ended). `gripLost` says the swing was reported with the grip lost mid-sweep, so the tracker's dropout
 * rules judged it, and `crossingPredicted` that its crossing was predicted rather than seen. When it left the load and
 * crossed the midline (capture clock); when the frame that reported it was taken and handled; when the page saw it
 * end; and when the stage judged the swing, and how. `measured` is null for a swing never seen mid-sweep (made between
 * two frames, or the dev stand-in's); its `closing` is the grip's speed toward the midline on the last frame it was on.
 */
export type SweepNote = {
  swing: boolean
  failures: SweepFailure[]
  gripLost: boolean
  crossingPredicted: boolean
  leftLoadAt: number
  crossedAt: number | null
  reported: { capturedAt: number; handledAt: number } | null
  handledAt: number
  speed: number
  measured: {
    travel: number
    headShift: number
    energy: number
    energyNeeded: number
    moving: number
    closing: number
  } | null
  stage: ({ at: number } & Pick<PitchResult, 'outcome' | 'timing' | 'errorMs'>) | null
}

/** One run of the object detector: how long (ms) it took and what it found. */
export type ObjectRun = { ms: number; result: ObjectDetectorResult | null }

/** The sweep the tracker is on, and its crossing as of the last frame it was on (null: not crossed yet). */
export type FollowedSweep = { sweep: Sweep; crossedBefore: number | null }

/**
 * The notes of the last minute, the detector run the next note takes, the sweep the tracker is on, the lock and the
 * latest detector run's best candidate (and when it ran), and the camera picture's size.
 */
export type Diagnostics = {
  frames: FrameNote[]
  sweeps: SweepNote[]
  pendingObjects: ObjectRun | null
  followed: FollowedSweep | null
  lock: LockNote | null
  candidate: { at: number; best: CandidateNote | null } | null
  video: { width: number; height: number } | null
}

export function createDiagnostics(): Diagnostics {
  return {
    frames: [],
    sweeps: [],
    pendingObjects: null,
    followed: null,
    lock: null,
    candidate: null,
    video: null,
  }
}

export const DIAGNOSTICS: Diagnostics = createDiagnostics()

/**
 * `parts` with the object detector timed, each run left for the note of the frame it ran on; the pose loop already
 * times the pose task (vision/poseLoop.ts), and the frame brings that.
 */
export function diagnosedCameraParts(
  parts: CameraTrackingParts,
  diagnostics: Diagnostics = DIAGNOSTICS,
): CameraTrackingParts {
  return {
    ...parts,
    createObjectDetector: async () =>
      timedTask(await parts.createObjectDetector(), (ms, result) => {
        diagnostics.pendingObjects = { ms, result }
      }),
  }
}

/**
 * Forgets what the diagnostics kept of a camera that turned off: the sweep they followed, image points and all, and a
 * detector run no frame took. The notes stay, so L still saves them.
 */
export function forgetDiagnosedCamera(diagnostics: Diagnostics = DIAGNOSTICS) {
  diagnostics.followed = null
  diagnostics.pendingObjects = null
}

/** `task`, telling `onRun` how long (ms) each run took and what it found. */
export function timedTask<Result>(
  task: VisionTask<Result>,
  onRun: (ms: number, result: Result | null) => void,
): VisionTask<Result> {
  return {
    detect: (frame, frameTime) => {
      const startedAt = performance.now()
      const result = task.detect(frame, frameTime)
      onRun(performance.now() - startedAt, result)
      return result
    },
    close: () => task.close(),
  }
}

/**
 * One camera frame as the page handled it: how long (ms) the pose task took on it, the swing it handed over, if any,
 * and the stance hold after it.
 */
export type DiagnosedFrame = {
  frame: PoseFrame
  poseMs: number
  video: Pick<HTMLVideoElement, 'videoWidth' | 'videoHeight'>
  tracker: SwingTracker
  swing: RealTimeSwing | null
  stance: StanceFrame
  hold: StanceHold | null
}

/** Notes a frame the page handled at `now`, and the sweep it ended or the swing it reported, if any. */
export function diagnoseFrame(
  { frame, poseMs, video, tracker, swing, stance, hold }: DiagnosedFrame,
  diagnostics: Diagnostics = DIAGNOSTICS,
  now = performance.now(),
) {
  const objects = diagnostics.pendingObjects
  diagnostics.pendingObjects = null
  diagnostics.video = { width: video.videoWidth, height: video.videoHeight }
  const detections = objects?.result ? objectDetections(objects.result, video.videoWidth, video.videoHeight) : null
  const candidate = detections && tracker.view ? bestCandidate(detections, tracker.view, tracker.aspect) : null
  if (detections) diagnostics.candidate = { at: now, best: candidate }
  const matched = detections && tracker.lock ? lockedDetection(tracker.lock, detections, tracker.aspect) : null
  diagnostics.lock = nextLockNote(diagnostics.lock, tracker.lock, matched)
  diagnostics.frames.push({
    capturedAt: frame.capturedAt,
    handledAt: now,
    poseMs,
    objectsMs: objects?.ms ?? null,
    state: tracker.state,
    reason: tracker.reason,
    lock: diagnostics.lock,
    sightings: tracker.search.progress,
    candidate,
    grip: gripNote(tracker),
    speed: tracker.smoothedSpeed,
    energy: tracker.energy.value,
    moving: tracker.energy.moving,
    noise: tracker.baseline,
    stance: stanceNote(hold, stance, tracker),
  })
  const sweep = sweepNote(endedSweep(diagnostics.followed, tracker), tracker, swing, frame.capturedAt, now)
  diagnostics.followed = tracker.sweep && { sweep: tracker.sweep, crossedBefore: tracker.sweep.crossTime }
  if (sweep) diagnostics.sweeps.push(sweep)
  dropOlder(diagnostics.frames, now - DIAGNOSTICS_WINDOWS.logMs)
  dropOlder(diagnostics.sweeps, now - DIAGNOSTICS_WINDOWS.logMs)
}

/** Notes when the stage judged the latest swing handed to it, and how. */
export function diagnoseStageEvent(event: StageEvent, diagnostics: Diagnostics = DIAGNOSTICS, now = performance.now()) {
  if (event.type !== 'result' || !event.swing) return
  const reported = [...diagnostics.sweeps].reverse().find((sweep) => sweep.reported !== null)
  if (!reported || reported.stage) return
  const { outcome, timing, errorMs } = event.result
  reported.stage = { at: now, outcome, timing, errorMs }
}

/** Drops the notes handled before `since`, oldest first. */
export function dropOlder(notes: { handledAt: number }[], since: number) {
  const firstKept = notes.findIndex((note) => note.handledAt >= since)
  notes.splice(0, firstKept < 0 ? notes.length : firstKept)
}

/** The detection the tracker would lock first (vision/heldObject.ts lockCandidates), or else the nearest; null for none. */
export function bestCandidate(detections: readonly Detection[], view: HandsView, aspect: number): CandidateNote | null {
  const nearest = () =>
    detections
      .map((detection) => measureDetection(detection, view, aspect))
      .sort((first, second) => first.reach - second.reach)
      .at(0)
  const best = lockCandidates(detections, view, aspect).at(0) ?? nearest()
  return best ? { label: best.label, score: best.score, reach: best.reach } : null
}

/** The detection a detector-found `lock` was just seen as: the one its box overlaps most, if any. */
export function lockedDetection(lock: HeldObjectLock, detections: readonly Detection[], aspect: number) {
  if (lock.kind !== 'detected') return null
  const overlaps = detections.map((detection) => ({
    detection,
    overlap: intersectionOverUnion(toImageBox(detection.box, aspect), lock.box),
  }))
  const best = overlaps.filter(({ overlap }) => overlap > 0).sort((first, second) => second.overlap - first.overlap)
  return best.at(0)?.detection ?? null
}

/** The lock's note after a frame: none without a lock, the detection it was `matched` to, or as it was. */
export function nextLockNote(
  previous: LockNote | null,
  lock: HeldObjectLock | null,
  matched: Detection | null,
): LockNote | null {
  if (!lock) return null
  if (matched) return { kind: lock.kind, label: matched.label, score: matched.score }
  return previous?.kind === lock.kind ? previous : { kind: lock.kind, label: null, score: null }
}

export function gripNote({ view, side, frame }: SwingTracker): GripNote | null {
  if (!view) return null
  const shoulders = frame.frontal
  return {
    depth: ((view.grip.x - view.midX) / view.width) * side,
    drop: shoulders && gripDrop(view.grip, shoulders),
    source: view.source,
  }
}

/** What the stance hold made of a frame, measured as it measures; null while no step waits. */
export function stanceNote(hold: StanceHold | null, stance: StanceFrame, tracker: SwingTracker): StanceNote | null {
  if (!hold) return null
  const shoulders = tracker.frame.frontal
  const drop = stance.grip && shoulders ? gripDrop(stance.grip, shoulders) : null
  return {
    inStance: stance.inStance,
    seen: stance.grip !== null && stance.shoulderWidth !== null,
    armed: hold.armed,
    askedMs: stance.time - hold.since,
    settled: stanceSettled(hold, stance.time),
    loaded: tracker.state === 'loaded',
    drop,
    raised: drop !== null && gripRaised(drop),
    spread: stillSpread(hold.recent, stance.shoulderWidth),
    still: isStill(hold.recent, stance.shoulderWidth),
    heldMs: hold.heldMs,
  }
}

/** The sweep the tracker was on until this frame, as it ended (the tracker leaves it as it was then), if it ended. */
export function endedSweep(followed: FollowedSweep | null, tracker: SwingTracker) {
  return followed && followed.sweep !== tracker.sweep ? followed : null
}

/**
 * The note for a frame taken at `capturedAt` and handled at `now` that ended a sweep or reported a swing; null when
 * it did neither, and for a sweep toward the far side (the bat coming back) or one that never left the load (wobble).
 */
export function sweepNote(
  followed: FollowedSweep | null,
  tracker: SwingTracker,
  swing: RealTimeSwing | null,
  capturedAt: number,
  now: number,
): SweepNote | null {
  const ended = followed?.sweep ?? null
  if (!swing && !(ended && leftTheLoad(ended, tracker))) return null
  // A swing reported on a frame without the grip is the dropout rules' (vision/swingTracker.ts sweepDropout).
  const gripLost = swing !== null && ended !== null && gripUnseen(tracker)
  return {
    swing: swing !== null,
    failures: ended && !swing ? sweepFailures(tracker, ended) : [],
    gripLost,
    crossingPredicted: gripLost && followed?.crossedBefore === null,
    leftLoadAt: ended?.startedAt ?? swing?.startedAtRealMs ?? capturedAt,
    crossedAt: ended?.crossTime ?? swing?.contactAtRealMs ?? null,
    reported: swing && { capturedAt, handledAt: now },
    handledAt: now,
    speed: ended?.peak ?? swing?.speed ?? 0,
    measured: ended && {
      travel: ended.travel,
      headShift: ended.headShift,
      energy: ended.energy,
      energyNeeded: energyNeeded(tracker.baseline),
      moving: ended.moving,
      closing: -ended.velocity,
    },
    stage: null,
  }
}

/** Whether `sweep` went toward the batting side and left the load zone on its way. */
export function leftTheLoad(sweep: Sweep, tracker: SwingTracker) {
  return sweep.arm.side === tracker.side && leftLoadZone(sweep)
}

/** Whether the tracker lost the grip on this frame: no wrist seen, or the last grip held in its place. */
export function gripUnseen({ view }: SwingTracker) {
  return !view || view.source === 'hold'
}

/**
 * Over the notes handled in the last `windowMs` before `now`: the camera's frames per second, the pose task's median
 * time, the median wait from capture to handling, and the object detector's median time and runs per second.
 */
export function cameraSummary(frames: readonly FrameNote[], now: number, windowMs = DIAGNOSTICS_WINDOWS.summaryMs) {
  const recent = frames.filter((note) => now - note.handledAt <= windowMs)
  const objectTimes = recent.flatMap((note) => (note.objectsMs === null ? [] : [note.objectsMs]))
  const spanMs = recent.length > 1 ? recent[recent.length - 1].capturedAt - recent[0].capturedAt : 0
  return {
    fps: spanMs > 0 ? ((recent.length - 1) / spanMs) * 1000 : null,
    poseMs: medianOf(recent.map((note) => note.poseMs)),
    latencyMs: medianOf(recent.map((note) => note.handledAt - note.capturedAt)),
    objectsMs: medianOf(objectTimes),
    objectsPerSecond: (objectTimes.length / windowMs) * 1000,
  }
}

export function medianOf(values: readonly number[]) {
  return values.length > 0 ? median(values) : null
}

/** What a key does to the diagnostics: D shows or hides the panel, L saves the log; null for any other key. */
export function diagnosticsAction(event: Pick<KeyboardEvent, 'code' | 'repeat' | 'altKey' | 'ctrlKey' | 'metaKey'>) {
  if (isPlainKey(event, 'KeyD')) return 'toggle'
  return isPlainKey(event, 'KeyL') ? 'save' : null
}

/** The panel's text at `now`. */
export function diagnosticsText(diagnostics: Diagnostics, now: number) {
  const latest = diagnostics.frames.at(-1)
  const live = latest ? frameLines(diagnostics, latest, now) : ['camera  no frames yet']
  const keys = `D hides · L saves the last minute (${diagnostics.frames.length} frames, ${diagnostics.sweeps.length} sweeps)`
  return [...live, ...sweepLines(diagnostics.sweeps.at(-1) ?? null, now), keys].join('\n')
}

/**
 * The latest frame's lines, with the camera rated over the frames up to it, so a camera that stopped (as on a computer
 * found too slow) still shows how it ran.
 */
export function frameLines(diagnostics: Diagnostics, latest: FrameNote, now: number) {
  const camera = cameraSummary(diagnostics.frames, latest.handledAt)
  const sinceMs = now - latest.handledAt
  const stopped = sinceMs > DIAGNOSTICS_WINDOWS.summaryMs ? ` · stopped ${numberText(sinceMs / 1000)} s ago` : ''
  const { searching, locked } = OBJECT_DETECTION_INTERVAL_MS
  const objects =
    camera.objectsPerSecond > 0
      ? `${numberText(camera.objectsMs, 1)} ms × ${numberText(camera.objectsPerSecond, 1)}/s`
      : 'resting'
  return [
    `camera  ${numberText(camera.fps, 1)} fps · pose ${numberText(camera.poseMs, 1)} ms · lag ${numberText(camera.latencyMs)} ms${stopped}`,
    `objects ${objects} (due every ${searching}/${locked} ms)`,
    `tracker ${latest.state} · ${latest.reason ?? '–'}`,
    gripLine(latest),
    lockLine(latest),
    candidateLine(diagnostics.candidate, now),
    ...stanceLines(latest.stance),
  ]
}

export function gripLine({ grip, speed }: FrameNote) {
  if (!grip) return 'grip    not seen'
  const { loadOffset, still } = SWING_RULES
  return `grip    ${numberText(grip.depth, 2)} SW back (≥${loadOffset}) · ${numberText(speed, 1)} SW/s (<${still}) · ${grip.source}`
}

export function lockLine({ lock, sightings }: FrameNote) {
  const { lockHits, lockWindowMs } = HELD_OBJECT_RULES
  if (!lock) return `lock    none · ${sightings}/${lockHits} sightings in ${lockWindowMs} ms`
  return `lock    ${lock.kind}${lock.label === null ? '' : ` · ${lock.label} ${numberText(lock.score, 2)}`}`
}

export function candidateLine(candidate: Diagnostics['candidate'], now: number) {
  if (!candidate) return 'nearest not looked for yet'
  const ago = `${numberText((now - candidate.at) / 1000, 1)} s ago`
  const { best } = candidate
  if (!best) return `nearest nothing found · ${ago}`
  const { candidateScore, candidateReach } = HELD_OBJECT_RULES
  return `nearest ${best.label} ${numberText(best.score, 2)} (≥${candidateScore}) · ${numberText(best.reach, 2)} SW (≤${candidateReach}) · ${ago}`
}

export function stanceLines(stance: StanceNote | null) {
  if (!stance) return ['stance  not watched (no step waits, or not timed yet)']
  const { holdMs, settleMs, lowestGrip, stillShoulderWidths, stillWindowMs } = STANCE_HOLD_RULES
  return [
    `stance  ${stance.inStance ? 'in' : 'out'} · gauge ${numberText(stance.heldMs / 1000, 2)} / ${holdMs / 1000} s`,
    `  ${passMark(stance.seen)} seen (grip and shoulders)`,
    `  ${passMark(stance.armed)} armed (out of the stance since asked)`,
    `  ${passMark(stance.settled)} settled ${numberText(stance.askedMs / 1000, 1)} s since asked (≥${settleMs / 1000})`,
    `  ${passMark(stance.loaded)} batting side (tracker loaded)`,
    `  ${passMark(stance.raised)} grip raised ${numberText(stance.drop, 2)} SW below shoulders (≤${lowestGrip})`,
    `  ${passMark(stance.still)} still ${numberText(stance.spread, 2)} SW over ${stillWindowMs} ms (≤${stillShoulderWidths})`,
  ]
}

/** The last sweep's lines, timed from its midline crossing (or, if it never crossed, from leaving the load). */
export function sweepLines(sweep: SweepNote | null, now: number) {
  if (!sweep) return ['sweep   none toward the batting side in the last minute']
  const zero = sweep.crossedAt ?? sweep.leftLoadAt
  return [
    `sweep   ${sweepVerdict(sweep)} · ${numberText((now - sweep.handledAt) / 1000, 1)} s ago`,
    `  left load ${signedMs(sweep.leftLoadAt - zero)}`,
    `  crossed   ${crossedText(sweep)}`,
    `  reported  ${reportedText(sweep, zero)}`,
    `  stage     ${stageText(sweep, zero)}`,
    ...ruleLines(sweep),
  ]
}

export function sweepVerdict({ swing, failures, gripLost, crossingPredicted }: SweepNote) {
  if (!swing) return `no swing: ${failures.join(', ')}`
  if (!gripLost) return 'swing'
  return `swing (grip lost mid-sweep: dropout rules${crossingPredicted ? ', crossing predicted' : ''})`
}

export function crossedText({ crossedAt, leftLoadAt, crossingPredicted }: SweepNote) {
  const { crossWithinMs } = SWING_RULES
  if (crossedAt === null) return `never (within ${crossWithinMs} ms)`
  const predicted = crossingPredicted ? ', predicted, not seen' : ''
  return `${numberText(crossedAt - leftLoadAt)} ms after the load (≤${crossWithinMs})${predicted}`
}

export function reportedText({ reported }: SweepNote, zero: number) {
  if (!reported) return '–'
  const capture = `${signedMs(reported.capturedAt - zero)} capture (≤${SWING_RULES.finishWithinMs})`
  return `${capture} · ${signedMs(reported.handledAt - zero)} now`
}

export function stageText({ reported, stage }: SweepNote, zero: number) {
  if (!reported) return '–'
  if (!stage) return 'not judged by the stage (between pitches, before the release, or after the pitch had passed)'
  const timing = stage.timing === null ? '' : ` ${stage.timing} ${signedMs(stage.errorMs)}`
  return `${signedMs(stage.at - zero)} now · ${stage.outcome}${timing}`
}

/**
 * Each swing rule against the sweep's measure, marked as the tracker judged it when the sweep ended. A swing the
 * dropout rules judged met those instead, so it shows their measure first and these unmarked (·), for reference.
 */
export function ruleLines({ failures, gripLost, crossingPredicted, speed, measured }: SweepNote) {
  const passes = (failure: SweepFailure) => (gripLost ? '·' : passMark(!failures.includes(failure)))
  if (!measured) return [`  speed ${numberText(speed, 1)} SW/s · not seen mid-sweep`]
  const { swingSpeed, travel, energyArea, headShare, strongTravel, strongSpeed } = SWING_RULES
  const share = measured.travel > 0 ? measured.headShift / measured.travel : 0
  return [
    ...(gripLost ? [dropoutLine(measured, crossingPredicted)] : []),
    `  ${passes('speed')} speed  ${numberText(speed, 1)} SW/s (≥${swingSpeed})`,
    `  ${passes('travel')} travel ${numberText(measured.travel, 2)} SW (≥${travel})`,
    `  ${passes('energy')} energy ${numberText(measured.energy, 1)} (≥${numberText(measured.energyNeeded, 1)}) over ${numberText(measured.moving, 3)} (≥${energyArea}), or ${strongTravel} SW at ${strongSpeed} SW/s`,
    `  ${passes('body')} head   ${numberText(share, 2)} of the travel (≤${headShare})`,
  ]
}

/**
 * The dropout rules' measure: how fast the grip closed on the midline when it was lost, how far it had gone, and
 * whether it had crossed by then or was predicted to soon after.
 */
export function dropoutLine({ closing, travel }: NonNullable<SweepNote['measured']>, crossingPredicted: boolean) {
  const { fastBeforeLoss, dropoutTravel, dropoutHorizonMs } = SWING_RULES
  const crossing = crossingPredicted ? `predicted within ${dropoutHorizonMs} ms` : 'crossed before the loss'
  return `  ✓ dropout closing ${numberText(closing, 1)} SW/s (≥${fastBeforeLoss}) · travel ${numberText(travel, 2)} SW (≥${dropoutTravel}) · ${crossing}`
}

/** `value` to `digits` decimals, or a dash for none. */
export function numberText(value: number | null, digits = 0) {
  return value === null || !Number.isFinite(value) ? '–' : value.toFixed(digits)
}

export function signedMs(value: number | null) {
  if (value === null) return '–'
  return `${value < 0 ? '−' : '+'}${numberText(Math.abs(value))} ms`
}

export function passMark(passes: boolean) {
  return passes ? '✓' : '✗'
}

/** What L saves: the rules the notes are judged by, the picture's size, and the last minute of notes. */
export function diagnosticsLog(diagnostics: Diagnostics, savedAt: Date) {
  return {
    about:
      'Town of Me /baseball dev diagnostics: the last minute of camera frames as the swing tracker and the stance ' +
      'hold read them, and the sweeps toward the batting side. Numbers and state names only, no picture. Times are ' +
      'performance.now() ms (capturedAt: when the camera took the frame; handledAt: when the page handled it). ' +
      'Lengths are shoulder widths (SW): grip depth behind the body midline toward the batting side, grip drop below ' +
      'the shoulders.',
    savedAt: savedAt.toISOString(),
    video: diagnostics.video,
    rules: {
      swing: SWING_RULES,
      stance: STANCE_HOLD_RULES,
      heldObject: HELD_OBJECT_RULES,
      objectDetectionIntervalMs: OBJECT_DETECTION_INTERVAL_MS,
    },
    frames: diagnostics.frames,
    sweeps: diagnostics.sweeps,
  }
}

/** Numbers in the saved log to three decimals, which keeps a minute of frames small. */
export function roundedNumber(_key: string, value: unknown) {
  return typeof value === 'number' ? Math.round(value * 1000) / 1000 : value
}

/** Saves the log as a JSON file through the browser's download, from a Blob on this device. */
export function saveDiagnosticsLog(diagnostics: Diagnostics = DIAGNOSTICS, savedAt = new Date()) {
  const text = JSON.stringify(diagnosticsLog(diagnostics, savedAt), roundedNumber)
  const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }))
  const link = document.createElement('a')
  link.href = url
  link.download = `town-of-me-derby-diagnostics-${savedAt.toISOString().replace(/[:.]/g, '-')}.json`
  document.body.append(link)
  link.click()
  link.remove()
  // The download keeps its own copy once it has started.
  window.setTimeout(() => URL.revokeObjectURL(url), 1000)
}
