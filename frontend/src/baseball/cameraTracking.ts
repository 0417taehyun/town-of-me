import type { ObjectDetectorResult, PoseLandmarkerResult } from '@mediapipe/tasks-vision'
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { diagnosedCameraParts, diagnoseFrame, forgetDiagnosedCamera } from './devDiagnostics'
import { devSwingCue, devSwingSeen, devVisitorFrame } from './devSeam'
import { type CameraGameProblem, cameraProblem } from './deviceGate'
import {
  nextShownNeed,
  type ShownNeed,
  type StanceFrame,
  stanceFrame,
  type StanceHold,
  type StanceNeed,
  stanceProgress,
  type StanceWatch,
  watchStance,
} from './flow/stanceHold'
import type { BattingSide } from './game/field'
import type { RealTimeSwing, RealTimeSwingCue } from './stage/stageRun'
import { clearCameraView, drawCameraView } from './ui/cameraOverlay'
import { type CameraInput, type CameraStopReason, startCamera } from './vision/cameraInput'
import { type Detection, type HeldObjectLabel, objectDetections } from './vision/heldObject'
import { createMotionEnergy, type MotionEnergySampler } from './vision/motionEnergy'
import type { FrameTiming } from './vision/performanceTier'
import type { Point } from './vision/poseLandmarks'
import {
  AWAY_HOLD_MS,
  createFrameHandler,
  nextSight,
  type PoseFrame,
  runPoseLoop,
  seesVisitor,
  UNSEEN,
} from './vision/poseLoop'
import {
  createSwingTracker,
  forgetCamera,
  type HeldCaption,
  isLookingForObject,
  lockByHand,
  nextCaption,
  objectDetectionInterval,
  objectMark,
  setTrackerSide,
  type SwingCue,
  type SwingTracker,
  type TrackedSwing,
  type TrackerReason,
  updateSwingTracker,
} from './vision/swingTracker'
import { createObjectDetector, createPoseTracker, type VisionTask } from './vision/tasksVision'

// The camera game's camera, on from the visitor's click until they turn it off, leave the page, stand still for two
// minutes, or it turns out this computer is too slow. The vision loop (vision/poseLoop.ts) runs the pose task on each
// camera frame, and from there this page reads swings and draws the camera panel's canvas: the object detector every so
// often (vision/heldObject.ts), the motion where a swing goes (vision/motionEnergy.ts), and the swing tracker
// (vision/swingTracker.ts), whose swings and cues of a swing begun or checked go straight to the page's callbacks, as
// does the held stance's progress (flow/stanceHold.ts). React hears only when the camera's status changes, the visitor
// comes into or out of view, the tracker's caption changes, or what the stance hold waits for does.

/**
 * `starting` waits for the browser's permission, `loading` for the pose task, and `measuring` times it on this
 * computer before the camera game may start (vision/performanceTier.ts). `off` names why the camera turned itself
 * off, if it did; a `problem` names its cause and leaves another try; `tooSlow` blocks this computer for the visit.
 */
export type CameraStatus =
  | { kind: 'off'; stoppedBy: CameraStopReason | null }
  | { kind: 'starting' }
  | { kind: 'loading' }
  | { kind: 'measuring' }
  | { kind: 'ready' }
  | { kind: 'problem'; problem: CameraGameProblem }
  | { kind: 'tooSlow' }

export const CAMERA_OFF: CameraStatus = { kind: 'off', stoppedBy: null }

/** What the camera panel and the HUD's caption say about the camera. */
export type CameraStateId = 'starting' | 'searching' | 'seen' | 'stopped'

/** The statuses in which the camera is on, or about to be. */
export const CAMERA_ON_KINDS: readonly CameraStatus['kind'][] = ['starting', 'loading', 'measuring', 'ready']

export function isCameraOn(status: CameraStatus) {
  return CAMERA_ON_KINDS.includes(status.kind)
}

/** The camera's state in words' terms; null when the visitor turned it off or it never came on. */
export function cameraStateId(status: CameraStatus, seen: boolean): CameraStateId | null {
  if (status.kind === 'starting' || status.kind === 'loading') return 'starting'
  if (isCameraOn(status)) return seen ? 'seen' : 'searching'
  return status.kind === 'off' && status.stoppedBy ? 'stopped' : null
}

export type ObjectDetector = VisionTask<ObjectDetectorResult>

/** The pose loop's events: each status, and each tracked frame with how long (ms) the pose task took on it. */
export type PoseEvents = {
  onStatus: (status: CameraStatus) => void
  onFrame: (frame: PoseFrame, poseMs: number) => void
}

/**
 * The camera's events: each status, and each tracked frame with the object detector once it is ready (else null) and
 * how long (ms) the pose task took on it.
 */
export type CameraEvents = {
  onStatus: (status: CameraStatus) => void
  onFrame: (frame: PoseFrame, objects: ObjectDetector | null, poseMs: number) => void
}

/** What tracking the camera starts: the browser's in the page, fakes in tests. */
export type CameraTrackingParts = {
  start: typeof startCamera
  createTracker: () => Promise<VisionTask<PoseLandmarkerResult>>
  createObjectDetector: () => Promise<ObjectDetector>
}

export const BROWSER_CAMERA_PARTS: CameraTrackingParts = {
  start: startCamera,
  createTracker: createPoseTracker,
  createObjectDetector,
}

/**
 * Turns the camera on into `video` and tracks the visitor's pose on it until `signal` aborts. Reports every status
 * after `starting`, and nothing once `signal` aborts; the caller aborts it when a status leaves the camera off. The
 * pose task and the object detector load while the browser asks for the camera, so a first visit waits for all at
 * once; a camera that does not start names its cause, and a pose task that does not (or fails later) is a tracking
 * problem, not the camera's. The game needs no object detector: without one the visitor plays in free mode, or taps
 * the object in the camera picture.
 */
export async function trackCamera(
  video: HTMLVideoElement,
  signal: AbortSignal,
  { onStatus, onFrame }: CameraEvents,
  { start, createTracker, createObjectDetector: createObjects }: CameraTrackingParts = BROWSER_CAMERA_PARTS,
) {
  const report = (status: CameraStatus) => {
    if (!signal.aborted) onStatus(status)
  }
  const trackingFailed = () => report({ kind: 'problem', problem: 'tracking' })
  const tracker = createTracker()
  // Its failure is reported once the camera is on; until then nothing waits on it.
  void tracker.catch(() => undefined)
  const objects = readyObjectDetector(createObjects(), signal)
  const camera = await start(video, { signal, onStopped: (stoppedBy) => report({ kind: 'off', stoppedBy }) }).catch(
    (error: unknown) => {
      report({ kind: 'problem', problem: cameraProblem(error) })
      void tracker.then(
        (task) => task.close(),
        () => undefined,
      )
      return null
    },
  )
  if (!camera) return
  report({ kind: 'loading' })
  const onPose = (frame: PoseFrame, poseMs: number) => onFrame(frame, objects(), poseMs)
  try {
    followPose(video, camera, await tracker, signal, { onStatus: report, onFrame: onPose }, trackingFailed)
  } catch {
    trackingFailed()
  }
}

/**
 * The object detector `loading` builds, once it is ready and until `signal` aborts, which closes it; null before then,
 * and for good when it cannot load.
 */
export function readyObjectDetector(loading: Promise<ObjectDetector>, signal: AbortSignal) {
  let ready: ObjectDetector | null = null
  const onLoaded = (task: ObjectDetector) => {
    if (signal.aborted) return task.close()
    ready = task
    signal.addEventListener('abort', () => task.close(), { once: true })
  }
  void loading.then(onLoaded, () => undefined)
  return () => (signal.aborted ? null : ready)
}

/** Times and follows the pose `tracker` finds on each frame of `video` until `signal` aborts, which closes it. */
export function followPose(
  video: HTMLVideoElement,
  camera: CameraInput,
  tracker: VisionTask<PoseLandmarkerResult>,
  signal: AbortSignal,
  { onStatus, onFrame }: PoseEvents,
  onError: (error: unknown) => void,
) {
  if (signal.aborted) return tracker.close()
  signal.addEventListener('abort', () => tracker.close(), { once: true })
  onStatus({ kind: 'measuring' })
  const handleFrame = createFrameHandler(camera, (tier) => onStatus({ kind: tier ? 'ready' : 'tooSlow' }))
  const onTracked = (frame: PoseFrame, timing: FrameTiming) => {
    handleFrame(frame, timing)
    onFrame(frame, timing.inferenceMs)
  }
  runPoseLoop(video, tracker, signal, onTracked, onError)
}

/** One camera's swing reading: the tracker, the motion sampler, and when the object detector last ran. */
export type SwingReading = { tracker: SwingTracker; energy: MotionEnergySampler; objectsRanAt: number }

export function createSwingReading(side: BattingSide): SwingReading {
  return { tracker: createSwingTracker(side), energy: createMotionEnergy(), objectsRanAt: -Infinity }
}

/** Wipes what a reading kept of the camera once it is off: the motion sampler's last picture and the tracked body. */
export function clearSwingReading(reading: SwingReading) {
  reading.energy.clear()
  forgetCamera(reading.tracker)
}

/**
 * One camera frame's swing reading: the object detector when it is due and may run, the motion in the swing's band,
 * then the tracker. Returns the swing the frame completed, if any.
 */
export function readSwingFrame(
  reading: SwingReading,
  frame: PoseFrame,
  video: HTMLVideoElement,
  objects: ObjectDetector | null,
  objectsPaused: boolean,
): RealTimeSwing | null {
  const detections = objectsPaused ? null : detectObjects(reading, frame.capturedAt, video, objects)
  const energy = reading.energy.measure(video, reading.tracker.band)
  const body = frame.body
  const swing = updateSwingTracker(reading.tracker, { time: frame.capturedAt, body, detections, energy })
  return swing && cameraSwing(swing)
}

/**
 * The held objects on `video`'s frame at `nowMs` when the detector is due (objectDetectionInterval); null when it does
 * not run. While the tracker looks for an object, a detector not at hand (still loading, failed, or being rebuilt)
 * finds nothing, so the search still runs out to free mode.
 */
export function detectObjects(
  reading: SwingReading,
  nowMs: number,
  video: HTMLVideoElement,
  objects: ObjectDetector | null,
): Detection[] | null {
  const interval = objectDetectionInterval(reading.tracker, nowMs)
  if (interval === null || nowMs - reading.objectsRanAt < interval) return null
  reading.objectsRanAt = nowMs
  const result = objects?.detect(video, nowMs) ?? null
  if (result) return objectDetections(result, video.videoWidth, video.videoHeight)
  return isLookingForObject(reading.tracker) ? [] : null
}

/** A tracked swing for the stage: the camera's, on the clock of the frames it was seen in (performance.now() ms). */
export function cameraSwing({ contactAtMs, startedAtMs, speed, batHeight }: TrackedSwing): RealTimeSwing {
  return { contactAtRealMs: contactAtMs, startedAtRealMs: startedAtMs, speed, batHeight }
}

/** A tracker's cue of a swing begun or checked for the stage, on the same clock as its swings. */
export function cameraSwingCue(cue: SwingCue): RealTimeSwingCue {
  return cue.kind === 'started' ? { kind: 'started', crossingAtRealMs: cue.crossingAtMs } : cue
}

export type CameraTrackingOptions = {
  /** The side the visitor bats from, which sets where a swing loads. */
  side: BattingSide
  /**
   * The object detector rests while this is true (a pitch in play), so the frames that time a swing come on time and
   * the batter's swing plays without a held-up frame.
   */
  objectsPaused: boolean
  /** Hears each swing the camera sees, the moment it is seen. */
  onSwing: (swing: RealTimeSwing) => void
  /** Hears the moment the camera sees the visitor begin a swing, or end one without a swing, for the batter's look. */
  onSwingCue: (cue: RealTimeSwingCue) => void
  stance: StanceWatch
  /** Whether the visitor is on the setup step, where free mode looks for a real object as often as a search does. */
  settingUp: boolean
  /** What the camera panel calls each object it marks, in the visitor's language. */
  objectNames: Record<HeldObjectLabel, string>
}

/**
 * What a dev build's stand-in visitor shows instead of the camera's picture, and the stand-in swings its frames report
 * (devSeam.ts); never in production.
 */
const DEV_VISITOR = import.meta.env.DEV ? devVisitorFrame : null
const DEV_SWING = import.meta.env.DEV ? devSwingSeen : null
const DEV_SWING_CUE = import.meta.env.DEV ? devSwingCue : null

/**
 * A dev build times the object detector and notes each frame for its diagnostics panel (devDiagnostics.ts), which
 * forgets the sweep it followed when the camera turns off; production runs the browser's parts as they are.
 */
const CAMERA_PARTS = import.meta.env.DEV ? diagnosedCameraParts(BROWSER_CAMERA_PARTS) : BROWSER_CAMERA_PARTS
const DEV_DIAGNOSE = import.meta.env.DEV ? diagnoseFrame : null
const DEV_FORGET_DIAGNOSED = import.meta.env.DEV ? forgetDiagnosedCamera : null

/** What the stance hold and the presence read of a frame: the dev stand-in's, if one stands in, else the camera's. */
export function visitorFrame(frame: PoseFrame, tracker: SwingTracker): { seen: boolean; stance: StanceFrame } {
  const time = frame.capturedAt
  return DEV_VISITOR?.(time) ?? { seen: seesVisitor(frame), stance: stanceFrame(tracker, time) }
}

/**
 * The camera for a page: `turnOn` starts it into the `video` element the camera panel mounts, and the vision loop draws
 * on the panel's `canvas` (with the object it marks, named by `objectNames`), locks the held object by itself, reads
 * swings for `onSwing` and their cues for `onSwingCue`, and follows the stance hold `stance` waits for. `seen` says
 * whether the camera sees the visitor, held through brief flickers (vision/poseLoop.ts), and `present` the same held
 * longer, as long as practice and a run wait before they pause (AWAY_HOLD_MS); `caption` is what the swing tracker says
 * (nextCaption), and `stanceNeed` what the stance hold waits for (nextShownNeed), null while none runs. `lockAt` locks
 * what the visitor tapped on the camera picture (a point in the raw image). The camera turns off on `turnOff`, when its
 * status leaves it off, and when the page's component unmounts; its last picture, the motion sampler's copy, and the
 * tracked body are wiped each time.
 */
export function useCameraTracking({
  side,
  objectsPaused,
  onSwing,
  onSwingCue,
  stance,
  settingUp,
  objectNames,
}: CameraTrackingOptions) {
  const video = useRef<HTMLVideoElement>(null)
  const canvas = useRef<HTMLCanvasElement>(null)
  const reading = useRef<SwingReading | null>(null)
  const page = useRef({ objectsPaused, onSwing, onSwingCue, stance, settingUp, objectNames })
  const [request, setRequest] = useState<symbol | null>(null)
  const [status, setStatus] = useState<CameraStatus>(CAMERA_OFF)
  const [seen, setSeen] = useState(false)
  const [present, setPresent] = useState(false)
  const [caption, setCaption] = useState<TrackerReason | null>(null)
  const [stanceNeed, setStanceNeed] = useState<StanceNeed | null>(null)

  useLayoutEffect(() => {
    page.current = { objectsPaused, onSwing, onSwingCue, stance, settingUp, objectNames }
    if (reading.current) setTrackerSide(reading.current.tracker, side)
  }, [objectsPaused, onSwing, onSwingCue, stance, settingUp, objectNames, side])

  useEffect(() => {
    const feed = video.current
    const picture = canvas.current
    const current = reading.current
    if (!request || !feed || !picture || !current) return
    const controller = new AbortController()
    let sight = UNSEEN
    let presence = UNSEEN
    let hold: StanceHold | null = null
    let shownProgress = 0
    let shownCaption: HeldCaption | null = null
    let shownNeed: ShownNeed | null = null
    // The object detector waits until this computer has been timed: the timing is of what a pitch sees, the pose task
    // and the frames the page draws, and the detector rests during a pitch.
    let timed = false
    const onStatus = (next: CameraStatus) => {
      timed = next.kind === 'ready'
      setStatus(next)
      if (!isCameraOn(next)) setRequest(null)
    }
    const onFrame = (frame: PoseFrame, objects: ObjectDetector | null, poseMs: number) => {
      current.tracker.settingUp = page.current.settingUp
      const tracked = readSwingFrame(current, frame, feed, objects, !timed || page.current.objectsPaused)
      const cue = current.tracker.cue ?? DEV_SWING_CUE?.(frame.capturedAt)
      if (cue) page.current.onSwingCue(cameraSwingCue(cue))
      const swing = tracked ?? DEV_SWING?.(frame.capturedAt)
      if (swing) page.current.onSwing(swing)
      const mark = objectMark(current.tracker, frame.capturedAt)
      drawCameraView(picture, feed, frame.keypoints, mark, page.current.objectNames)
      const visitor = visitorFrame(frame, current.tracker)
      hold = watchStance(hold, timed, visitor.stance, page.current.stance, shownProgress)
      DEV_DIAGNOSE?.({
        frame,
        poseMs,
        video: feed,
        tracker: current.tracker,
        swing: swing ?? null,
        stance: visitor.stance,
        hold,
      })
      shownProgress = stanceProgress(hold)
      const need = nextShownNeed(shownNeed, hold?.need ?? null, frame.capturedAt)
      if (need?.need !== shownNeed?.need) setStanceNeed(need?.need ?? null)
      shownNeed = need
      const now = performance.now()
      const next = nextSight(sight, visitor.seen, now)
      if (next.seen !== sight.seen) setSeen(next.seen)
      sight = next
      const nextPresence = nextSight(presence, visitor.seen, now, AWAY_HOLD_MS)
      if (nextPresence.seen !== presence.seen) setPresent(nextPresence.seen)
      presence = nextPresence
      const held = nextCaption(shownCaption, current.tracker, frame.capturedAt)
      if (held !== shownCaption) setCaption(held.caption)
      shownCaption = held
    }
    void trackCamera(feed, controller.signal, { onStatus, onFrame }, CAMERA_PARTS)
    return () => {
      controller.abort()
      clearCameraView(picture)
      clearSwingReading(current)
      DEV_FORGET_DIAGNOSED?.()
    }
  }, [request])

  const turnOn = useCallback(() => {
    reading.current = createSwingReading(side)
    setSeen(false)
    setPresent(false)
    setCaption(null)
    setStanceNeed(null)
    setStatus({ kind: 'starting' })
    setRequest(Symbol('camera'))
  }, [side])
  const turnOff = useCallback(() => {
    setStatus(CAMERA_OFF)
    setRequest(null)
  }, [])
  const lockAt = useCallback((point: Point) => {
    if (reading.current) lockByHand(reading.current.tracker, point)
  }, [])
  return { video, canvas, status, seen, present, caption, stanceNeed, turnOn, turnOff, lockAt }
}
