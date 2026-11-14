import type { ObjectDetectorResult, PoseLandmarkerResult } from '@mediapipe/tasks-vision'
import { describe, expect, it, vi } from 'vitest'
import {
  type CameraStatus,
  type CameraTrackingParts,
  type ObjectDetector,
  readSwingFrame,
  readyObjectDetector,
  type SwingReading,
  trackCamera,
} from './cameraTracking'
import { freeLock, HELD_OBJECT_RULES, lockOn } from './vision/heldObject'
import { NO_ENERGY } from './vision/motionEnergy'
import type { BodySample } from './vision/poseLandmarks'
import { createSwingTracker, objectMark, type SwingTracker } from './vision/swingTracker'
import type { VisionTask } from './vision/tasksVision'

const video = { videoWidth: 640, videoHeight: 480 } as HTMLVideoElement

/** A visitor standing square to the camera, hands together at the chest. */
const standing: BodySample = {
  wrists: { left: { x: 0.66, y: 0.6 }, right: { x: 0.68, y: 0.6 } },
  shoulders: { width: 0.2, midX: 0.67, midY: 0.35 },
  head: null,
  aspect: 4 / 3,
}

/** `standing`'s hands as the held object's lock sees them. */
const hands = { wrists: standing.wrists, grip: { x: 0.67, y: 0.6 }, width: 0.2 }

const FRAME_MS = 1000 / 30

/** Frames enough to span `ms`. */
function framesFor(ms: number) {
  return Math.ceil(ms / FRAME_MS)
}

/** A detector that finds a bottle standing up out of `standing`'s hands, in the video's pixels. */
const BOTTLE_IN_HANDS: ObjectDetector = {
  detect: (): ObjectDetectorResult => ({
    detections: [
      {
        categories: [{ categoryName: 'bottle', displayName: '', index: 0, score: 0.8 }],
        boundingBox: { originX: 302, originY: 144, width: 38, height: 154, angle: 0 },
        keypoints: [],
      },
    ],
  }),
  close: () => undefined,
}

const FINDS_NOTHING: ObjectDetector = { detect: () => ({ detections: [] }), close: () => undefined }

/** A patchy detector: it finds the bottle in `standing`'s hands on just every `runsApart`-th run, the first missing. */
function findsEvery(runsApart: number): ObjectDetector {
  let runs = 0
  const detect = (frame: TexImageSource, frameTime: number) => {
    runs += 1
    return (runs % runsApart === 0 ? BOTTLE_IN_HANDS : FINDS_NOTHING).detect(frame, frameTime)
  }
  return { detect, close: () => undefined }
}

/** `tracker`'s reading of the camera, its motion sampler seeing nothing move. */
function readingOf(tracker: SwingTracker): SwingReading {
  return { tracker, energy: { measure: () => NO_ENERGY, clear: () => undefined }, objectsRanAt: -Infinity }
}

/** `frames` 30 fps frames of `body` from `fromMs` read into `reading`, with `objects` as the detector, `paused` or not. */
function readFrames(
  reading: SwingReading,
  body: BodySample | null,
  objects: ObjectDetector | null,
  paused: boolean,
  frames: number,
  fromMs = 0,
) {
  Array.from({ length: frames }, (_, index) => fromMs + index * FRAME_MS).forEach((capturedAt) =>
    readSwingFrame(reading, { keypoints: null, body, capturedAt }, video, objects, paused),
  )
}

/**
 * How many times the object detector runs over `seconds` of frames of `body` for `tracker`, `paused` or not, finding
 * what `objects` finds.
 */
function detectorRuns(
  body: BodySample | null,
  tracker: SwingTracker,
  paused: boolean,
  seconds = 1,
  objects: ObjectDetector = FINDS_NOTHING,
) {
  const detect = vi.fn(objects.detect)
  readFrames(readingOf(tracker), body, { detect, close: () => undefined }, paused, framesFor(seconds * 1000))
  return detect.mock.calls.length
}

/** A tracker locked on the free mode stand-in, on the setup step or not. */
function freeTracker(settingUp: boolean): SwingTracker {
  return { ...createSwingTracker('right'), state: 'locked', settingUp, lock: freeLock(hands) }
}

/** A tracker locked on a bottle in `standing`'s hands, found by the detector or tapped on the camera picture. */
function bottleTracker(kind: 'detected' | 'manual' = 'detected'): SwingTracker {
  const box = { x: 0.63, y: 0.3, width: 0.08, height: 0.32 }
  return { ...createSwingTracker('right'), state: 'locked', lock: lockOn(hands, box, kind) }
}

/** Tracks the camera with `parts` and returns the statuses it reported. */
async function statusesOf(parts: Omit<CameraTrackingParts, 'createObjectDetector'> & Partial<CameraTrackingParts>) {
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

  it('blames tracking, not the camera, when the pose task cannot start, and loads no object detector before it', async () => {
    const createObjectDetector = vi.fn<CameraTrackingParts['createObjectDetector']>()
    const statuses = await statusesOf({
      start: async () => ({ noteMovement: () => undefined }),
      createTracker: async () => {
        throw new Error('Failed to fetch the model')
      },
      createObjectDetector,
    })
    expect(statuses).toEqual([{ kind: 'loading' }, { kind: 'problem', problem: 'tracking' }])
    expect(createObjectDetector).not.toHaveBeenCalled()
  })

  it('rests the object detector during a pitch, while no hands show, and for a tapped lock', () => {
    expect(detectorRuns(standing, createSwingTracker('right'), true)).toBe(0)
    expect(detectorRuns(standing, bottleTracker(), true)).toBe(0)
    // What a run finds is judged against the hands, so with nobody in view, as in a fake camera's picture, none runs.
    expect(detectorRuns(null, createSwingTracker('right'), false)).toBe(0)
    // A tapped lock is the visitor's own word, which no run refreshes or replaces.
    expect(detectorRuns(standing, bottleTracker('manual'), false)).toBe(0)
  })

  it('searches at a pace that fits a lock with every other sighting missed, then only glances', () => {
    const { lockHits, lockWindowMs } = HELD_OBJECT_RULES
    const searching = detectorRuns(standing, createSwingTracker('right'), false, lockWindowMs / 1000)
    expect(searching).toBeGreaterThanOrEqual(2 * lockHits - 1)
    // Each run holds up the pose frames, so with an object locked and seen, or nothing by the hands, a run comes about
    // once a second, and with nothing by them on the setup step, where the visitor picks up what they swing, twice.
    expect(detectorRuns(standing, bottleTracker(), false, 3, BOTTLE_IN_HANDS)).toBeLessThanOrEqual(3)
    expect(detectorRuns(standing, freeTracker(false), false, 3)).toBeLessThanOrEqual(3)
    expect(detectorRuns(standing, freeTracker(true), false, 3)).toBeLessThanOrEqual(6)
  })

  it('keeps a bottle in the still hands that a patchy detector misses three runs in a row', () => {
    const reading = readingOf(bottleTracker())
    readFrames(reading, standing, findsEvery(4), false, framesFor(6000))
    expect(reading.tracker.lock?.kind).toBe('detected')
  })

  it('lets a bottle go within some 2.6 s of being put down, even just after a glance found it', () => {
    // The first frame brings the hands into view, and the second's run finds the bottle, put down just after.
    const reading = readingOf(bottleTracker())
    readFrames(reading, standing, BOTTLE_IN_HANDS, false, 2)
    readFrames(reading, standing, FINDS_NOTHING, false, framesFor(2700) - 2, 2 * FRAME_MS)
    expect(reading.tracker.lock?.kind).toBe('free')
  })

  it('locks a bottle picked up in hands-only mode on the setup step within about a second', () => {
    // The first frame brings the hands into view, the second's glance finds them empty, and the next, half a second
    // on, finds the bottle, which a search's pace then locks.
    const setup = readingOf(freeTracker(true))
    readFrames(setup, standing, FINDS_NOTHING, false, 2)
    readFrames(setup, standing, BOTTLE_IN_HANDS, false, framesFor(1200) - 2, 2 * FRAME_MS)
    expect(setup.tracker.lock).toMatchObject({ kind: 'detected', label: 'bottle' })
  })

  it('locks a bottle a patchy detector finds while it glances in hands-only play', () => {
    // A bottle the detector finds on every other run, the first glance missing it: the next glance, a second later,
    // finds it, unmarked on the picture, and the misses between later sightings keep the pace of a search, so it locks
    // little more than a second after that.
    const relocking = readingOf(freeTracker(false))
    const patchy = findsEvery(2)
    const glanced = framesFor(1100)
    readFrames(relocking, standing, patchy, false, glanced)
    expect(relocking.tracker.candidate).toMatchObject({ label: 'bottle' })
    expect(objectMark(relocking.tracker, glanced * FRAME_MS)).toBeNull()
    readFrames(relocking, standing, patchy, false, framesFor(2300) - glanced, glanced * FRAME_MS)
    expect(relocking.tracker.lock).toMatchObject({ kind: 'detected', label: 'bottle' })
  })

  it('plays free mode without an object detector at hand, as when the detector finds nothing', () => {
    const tracker = createSwingTracker('right')
    readFrames(readingOf(tracker), standing, null, false, framesFor(HELD_OBJECT_RULES.handsOnlyAfterMs + 1000))
    expect(tracker.lock?.kind).toBe('free')
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
