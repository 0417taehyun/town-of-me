import type { PoseLandmarkerResult } from '@mediapipe/tasks-vision'
import { describe, expect, it, vi } from 'vitest'
import {
  type CameraStatus,
  type CameraTrackingParts,
  readSwingFrame,
  readyObjectDetector,
  trackCamera,
} from './cameraTracking'
import { NO_ENERGY } from './vision/motionEnergy'
import type { BodySample } from './vision/poseLandmarks'
import { createSwingTracker } from './vision/swingTracker'
import type { VisionTask } from './vision/tasksVision'

const video = { videoWidth: 640, videoHeight: 480 } as HTMLVideoElement

/** A visitor standing square to the camera, hands together at the chest. */
const standing: BodySample = {
  wrists: { left: { x: 0.66, y: 0.6 }, right: { x: 0.68, y: 0.6 } },
  shoulders: { width: 0.2, midX: 0.67, midY: 0.35 },
  head: null,
  aspect: 4 / 3,
}

/**
 * How many times the object detector runs over a second of 30 fps frames of `body`, `paused` or not, for a tracker
 * looking for an object (or, in `freeMode`, locked at once without one).
 */
function detectorRuns(body: BodySample | null, freeMode: boolean, paused: boolean) {
  const detect = vi.fn(() => ({ detections: [] }))
  const reading = {
    tracker: createSwingTracker('right', freeMode),
    energy: { measure: () => NO_ENERGY, clear: () => undefined },
    objectsRanAt: -Infinity,
  }
  Array.from({ length: 30 }, (_, index) => index * (1000 / 30)).forEach((capturedAt) =>
    readSwingFrame(reading, { keypoints: null, body, capturedAt }, video, { detect, close: () => undefined }, paused),
  )
  return detect.mock.calls.length
}

/** Tracks the camera with `parts` and returns the statuses it reported. */
async function statusesOf(parts: Omit<CameraTrackingParts, 'createObjectDetector'>) {
  const statuses: CameraStatus[] = []
  await trackCamera(
    video,
    new AbortController().signal,
    { onStatus: (status) => statuses.push(status), onFrame: () => undefined },
    { createObjectDetector: async () => ({ detect: () => null, close: () => undefined }), ...parts },
  )
  return statuses
}

describe('camera tracking', () => {
  it('names a refused camera as its cause and frees the pose task that loaded meanwhile', async () => {
    const tracker: VisionTask<PoseLandmarkerResult> = { detect: () => null, close: vi.fn() }
    const statuses = await statusesOf({
      start: async () => {
        throw new DOMException('Permission denied', 'NotAllowedError')
      },
      createTracker: async () => tracker,
    })
    expect(statuses).toEqual([{ kind: 'problem', problem: 'denied' }])
    await vi.waitFor(() => expect(tracker.close).toHaveBeenCalled())
  })

  it('blames tracking, not the camera, when the pose task cannot start on a camera that works', async () => {
    const statuses = await statusesOf({
      start: async () => ({ noteMovement: () => undefined }),
      createTracker: async () => {
        throw new Error('Failed to fetch the model')
      },
    })
    expect(statuses).toEqual([{ kind: 'loading' }, { kind: 'problem', problem: 'tracking' }])
  })

  it('rests the object detector during a pitch, and runs it often while looking for an object, less once locked', () => {
    expect(detectorRuns(null, false, true)).toBe(0)
    expect(detectorRuns(standing, true, true)).toBe(0)
    const searching = detectorRuns(null, false, false)
    const locked = detectorRuns(standing, true, false)
    expect(locked).toBeGreaterThanOrEqual(3)
    expect(searching).toBeGreaterThan(1.5 * locked)
  })

  it('closes an object detector that finishes loading after the camera turned off, and hands out none after', async () => {
    const detector = { detect: () => null, close: vi.fn() }
    const camera = new AbortController()
    let loaded: (task: typeof detector) => void = () => undefined
    const objects = readyObjectDetector(new Promise((resolve) => (loaded = resolve)), camera.signal)
    expect(objects()).toBeNull()
    camera.abort()
    loaded(detector)
    await vi.waitFor(() => expect(detector.close).toHaveBeenCalledTimes(1))
    expect(objects()).toBeNull()
  })
})
