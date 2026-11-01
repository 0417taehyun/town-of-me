import type { PoseLandmarkerResult } from '@mediapipe/tasks-vision'
import type { CameraInput } from './cameraInput'
import { type FrameTiming, type PerformanceTier, performanceTier, timingSummary } from './performanceTier'
import { type BodySample, bodyMoved, bodySample, type Keypoints, poseKeypoints } from './poseLandmarks'
import type { VisionTask } from './tasksVision'

// The vision loop: the pose task on each new camera frame, straight from the video's frame callback, with the page's
// drawn frames timed beside it. The first frames time this computer (performanceTier.ts), and movement keeps the camera
// on (cameraInput.ts). Nothing here touches React; the caller hears each frame's pose.

/**
 * One camera frame's upper body, both null when nobody is in view, and when the camera took the frame
 * (performance.now() ms), which times a swing seen in it.
 */
export type PoseFrame = { keypoints: Keypoints | null; body: BodySample | null; capturedAt: number }

/** The pose task's first pose in an image `aspect` (width / height) wide, taken at `capturedAt`. */
export function poseFrame(result: PoseLandmarkerResult | null, aspect: number, capturedAt: number): PoseFrame {
  const landmarks = result?.landmarks.at(0)
  if (!landmarks) return { keypoints: null, body: null, capturedAt }
  const keypoints = poseKeypoints(landmarks)
  return { keypoints, body: bodySample(keypoints, aspect), capturedAt }
}

/** A capture time further back than this (ms) from the frame's callback is not believed. */
export const CAPTURE_TIME_LIMIT_MS = 500

/**
 * When the camera took a frame that reached the page at `frameTime` (the frame callback's time): the browser's capture
 * time when it gives a believable one, so a swing is timed when it happened rather than after the frame was carried,
 * decoded, and tracked; otherwise the callback's time. The delay before the capture time is left to the practice
 * swings' calibration (game/calibration.ts).
 */
export function frameCapturedAt(frameTime: number, captureTime: number | undefined) {
  const believable = captureTime !== undefined && captureTime <= frameTime
  return believable && frameTime - captureTime < CAPTURE_TIME_LIMIT_MS ? captureTime : frameTime
}

/** Whether a frame shows the visitor well enough to follow a swing: both shoulders, which give the body its scale. */
export function seesVisitor(frame: PoseFrame) {
  return Boolean(frame.body?.shoulders)
}

/**
 * How long (ms) frames must keep saying otherwise before the visitor counts as lost or found: long enough that a
 * shoulder hidden for a swing, or one flickering frame, does not bring the camera panel back mid-pitch or make a
 * screen reader announce it, short enough that someone who steps out sees the panel come back to guide them.
 */
export const SIGHT_HOLD_MS = { lost: 1000, found: 500 }

/** Whether the camera sees the visitor, and since when (ms) frames have said otherwise, if they have. */
export type Sight = { seen: boolean; changingSince: number | null }

export const UNSEEN: Sight = { seen: false, changingSince: null }

/** `sight` after a frame at `now` that does or does not show the visitor (`seenNow`). */
export function nextSight(sight: Sight, seenNow: boolean, now: number): Sight {
  if (seenNow === sight.seen) return { seen: sight.seen, changingSince: null }
  const changingSince = sight.changingSince ?? now
  const hold = sight.seen ? SIGHT_HOLD_MS.lost : SIGHT_HOLD_MS.found
  if (now - changingSince < hold) return { seen: sight.seen, changingSince }
  return { seen: seenNow, changingSince: null }
}

/**
 * Handles each tracked frame: movement keeps the camera on, and the first frames time this computer until its tier is
 * known, which `onMeasured` hears once (null when it meets no tier).
 */
export function createFrameHandler(
  camera: CameraInput,
  onMeasured: (tier: PerformanceTier | null) => void,
): (frame: PoseFrame, timing: FrameTiming) => void {
  const timings: FrameTiming[] = []
  let measured = false
  let lastMoved: BodySample | null = null
  const measure = (timing: FrameTiming) => {
    if (measured) return
    timings.push(timing)
    const summary = timingSummary(timings)
    if (!summary) return
    measured = true
    onMeasured(performanceTier(summary))
  }
  return (frame, timing) => {
    measure(timing)
    if (!bodyMoved(lastMoved, frame.body)) return
    lastMoved = frame.body
    camera.noteMovement()
  }
}

/**
 * Collects the gaps (ms) between the frames the page draws until `signal` aborts. The returned function takes the gaps
 * collected since it last did.
 */
export function watchFrameIntervals(signal: AbortSignal) {
  let intervals: number[] = []
  let previous: number | null = null
  let handle = 0
  const onDrawn = (now: number) => {
    if (previous !== null) intervals.push(now - previous)
    previous = now
    handle = requestAnimationFrame(onDrawn)
  }
  handle = requestAnimationFrame(onDrawn)
  signal.addEventListener('abort', () => cancelAnimationFrame(handle), { once: true })
  return () => {
    const taken = intervals
    intervals = []
    return taken
  }
}

/**
 * Runs `tracker` on each new frame of `video` until `signal` aborts, handing `onFrame` the pose, how long the task took,
 * and the page's drawn frames since the last camera frame. The browser skips camera frames that come while the task is
 * still busy. An error stops the loop and goes to `onError`.
 */
export function runPoseLoop(
  video: HTMLVideoElement,
  tracker: VisionTask<PoseLandmarkerResult>,
  signal: AbortSignal,
  onFrame: (frame: PoseFrame, timing: FrameTiming) => void,
  onError: (error: unknown) => void,
) {
  const takeFrameIntervals = watchFrameIntervals(signal)
  let handle = 0
  const track = (frameTime: number, metadata: VideoFrameCallbackMetadata) => {
    const startedAt = performance.now()
    const result = tracker.detect(video, frameTime)
    const inferenceMs = performance.now() - startedAt
    const capturedAt = frameCapturedAt(frameTime, metadata.captureTime)
    onFrame(poseFrame(result, metadata.width / metadata.height, capturedAt), {
      inferenceMs,
      frameIntervalsMs: takeFrameIntervals(),
    })
  }
  const onVideoFrame: VideoFrameRequestCallback = (frameTime, metadata) => {
    if (signal.aborted) return
    try {
      track(frameTime, metadata)
    } catch (error) {
      onError(error)
      return
    }
    handle = video.requestVideoFrameCallback(onVideoFrame)
  }
  handle = video.requestVideoFrameCallback(onVideoFrame)
  signal.addEventListener('abort', () => video.cancelVideoFrameCallback(handle), { once: true })
}
