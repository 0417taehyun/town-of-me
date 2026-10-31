import type { PoseLandmarkerResult } from '@mediapipe/tasks-vision'
import { useCallback, useEffect, useRef, useState } from 'react'
import { type CameraGameProblem, cameraProblem } from './deviceGate'
import { clearCameraView, drawCameraView } from './ui/cameraOverlay'
import { type CameraInput, type CameraStopReason, startCamera } from './vision/cameraInput'
import type { FrameTiming } from './vision/performanceTier'
import { createFrameHandler, nextSight, type PoseFrame, runPoseLoop, seesVisitor, UNSEEN } from './vision/poseLoop'
import { createPoseTracker, type VisionTask } from './vision/tasksVision'

// The camera game's camera, on from the visitor's click until they turn it off, leave the page, stand still for two
// minutes, or it turns out this computer is too slow. The vision loop (vision/poseLoop.ts) runs the pose task on each
// camera frame, and this page draws it on the camera panel's canvas from there; React hears only when the camera's
// status changes or the visitor comes into or out of view. The camera shows the batter; nothing reads a swing yet.

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

export type CameraEvents = {
  onStatus: (status: CameraStatus) => void
  onFrame: (frame: PoseFrame) => void
}

/** What tracking the camera starts: the browser's in the page, fakes in tests. */
export type CameraTrackingParts = {
  start: typeof startCamera
  createTracker: () => Promise<VisionTask<PoseLandmarkerResult>>
}

export const BROWSER_CAMERA_PARTS: CameraTrackingParts = { start: startCamera, createTracker: createPoseTracker }

/**
 * Turns the camera on into `video` and tracks the visitor's pose on it until `signal` aborts. Reports every status
 * after `starting`, and nothing once `signal` aborts; the caller aborts it when a status leaves the camera off. The
 * pose task loads while the browser asks for the camera, so a first visit waits for both at once; a camera that does
 * not start names its cause, and a task that does not (or fails later) is a tracking problem, not the camera's.
 */
export async function trackCamera(
  video: HTMLVideoElement,
  signal: AbortSignal,
  { onStatus, onFrame }: CameraEvents,
  { start, createTracker }: CameraTrackingParts = BROWSER_CAMERA_PARTS,
) {
  const report = (status: CameraStatus) => {
    if (!signal.aborted) onStatus(status)
  }
  const trackingFailed = () => report({ kind: 'problem', problem: 'tracking' })
  const tracker = createTracker()
  // Its failure is reported once the camera is on; until then nothing waits on it.
  void tracker.catch(() => undefined)
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
  try {
    followPose(video, camera, await tracker, signal, { onStatus: report, onFrame }, trackingFailed)
  } catch {
    trackingFailed()
  }
}

/** Times and follows the pose `tracker` finds on each frame of `video` until `signal` aborts, which closes it. */
export function followPose(
  video: HTMLVideoElement,
  camera: CameraInput,
  tracker: VisionTask<PoseLandmarkerResult>,
  signal: AbortSignal,
  { onStatus, onFrame }: CameraEvents,
  onError: (error: unknown) => void,
) {
  if (signal.aborted) return tracker.close()
  signal.addEventListener('abort', () => tracker.close(), { once: true })
  onStatus({ kind: 'measuring' })
  const handleFrame = createFrameHandler(camera, (tier) => onStatus({ kind: tier ? 'ready' : 'tooSlow' }))
  const onTracked = (frame: PoseFrame, timing: FrameTiming) => {
    handleFrame(frame, timing)
    onFrame(frame)
  }
  runPoseLoop(video, tracker, signal, onTracked, onError)
}

/**
 * The camera for a page: `turnOn` starts it into the `video` element the camera panel mounts, and the vision loop
 * draws on the panel's `canvas`. `seen` says whether the camera sees the visitor, held through brief flickers
 * (vision/poseLoop.ts). The camera turns off on `turnOff`, when its status leaves it off, and when the page's component
 * unmounts; its last picture is wiped each time.
 */
export function useCameraTracking() {
  const video = useRef<HTMLVideoElement>(null)
  const canvas = useRef<HTMLCanvasElement>(null)
  const [request, setRequest] = useState<symbol | null>(null)
  const [status, setStatus] = useState<CameraStatus>(CAMERA_OFF)
  const [seen, setSeen] = useState(false)

  useEffect(() => {
    const feed = video.current
    const picture = canvas.current
    if (!request || !feed || !picture) return
    const controller = new AbortController()
    let sight = UNSEEN
    const onStatus = (next: CameraStatus) => {
      setStatus(next)
      if (!isCameraOn(next)) setRequest(null)
    }
    const onFrame = (frame: PoseFrame) => {
      drawCameraView(picture, feed, frame.keypoints)
      const next = nextSight(sight, seesVisitor(frame), performance.now())
      if (next.seen !== sight.seen) setSeen(next.seen)
      sight = next
    }
    void trackCamera(feed, controller.signal, { onStatus, onFrame })
    return () => {
      controller.abort()
      clearCameraView(picture)
    }
  }, [request])

  const turnOn = useCallback(() => {
    setSeen(false)
    setStatus({ kind: 'starting' })
    setRequest(Symbol('camera'))
  }, [])
  const turnOff = useCallback(() => {
    setStatus(CAMERA_OFF)
    setRequest(null)
  }, [])
  return { video, canvas, status, seen, turnOn, turnOff }
}
