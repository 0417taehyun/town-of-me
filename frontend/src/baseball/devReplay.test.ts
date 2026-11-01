import type { NormalizedLandmark, ObjectDetectorResult, PoseLandmarkerResult } from '@mediapipe/tasks-vision'
import { describe, expect, it } from 'vitest'
import { type ObjectDetector, readSwingFrame, type SwingReading } from './cameraTracking'
import {
  createDiagnostics,
  diagnosedCameraParts,
  diagnoseFrame,
  diagnoseTap,
  type Diagnostics,
  diagnosticsLogText,
  type FrameNote,
  forgetDiagnosedCamera,
  roundedNumber,
  SAVED_LANDMARK_INDEX,
} from './devDiagnostics'
import { replayDiagnosticsLog } from './devReplay'
import { followStance, STANCE_HOLD_RULES, type StanceHold, stanceFrame, type StanceWait } from './flow/stanceHold'
import type { RealTimeSwing } from './stage/stageRun'
import type { Energy } from './vision/motionEnergy'
import { poseFrame } from './vision/poseLoop'
import { createSwingTracker, lockByHand, SWING_RULES, type SwingCue } from './vision/swingTracker'
import type { VisionTask } from './vision/tasksVision'

// A fictional left-handed visitor on a 1280 × 720 webcam, facing it, shoulders 0.15 of the picture's width apart
// around x = 0.5 (one shoulder width, SW), so they load on the picture's right. Every number the page reads is in
// thousandths, as the saved file keeps it, so the session the page saw and the file's replay read the same numbers.

const video = { videoWidth: 1280, videoHeight: 720 } as HTMLVideoElement
const ASPECT = 1280 / 720
const FRAME_MS = 33
const QUIET: Energy = { value: 1, moving: 0.01 }
const LOUD: Energy = { value: 12, moving: 0.25 }
/** The load, SW from the midline toward the picture's right, where a left-handed batter loads. */
const LOAD = 0.6
const SETUP: StanceWait = { key: 'setup@1000', afterSwings: false }

/** The detector boxes a bottle standing up out of the fist at the load, in the video's pixels. */
const BOTTLE_AT_THE_LOAD: ObjectDetectorResult = {
  detections: [
    {
      categories: [{ categoryName: 'bottle', displayName: '', index: 0, score: 0.8 }],
      boundingBox: { originX: 736, originY: 180, width: 32, height: 144, angle: 0 },
      keypoints: [],
    },
  ],
}

/** What the camera shows: the hands' place (SW from the body's midline; null with nobody in view), and the motion. */
type Scene = { offset: number | null; energy: Energy }

/**
 * The page's camera as the test plays it, with its object detector (null while none is at hand), the diagnostics taking
 * notes, and the swings and the cues the page heard.
 */
type Session = {
  scene: Scene
  time: number
  pose: VisionTask<PoseLandmarkerResult>
  detector: ObjectDetector
  objects: ObjectDetector | null
  reading: SwingReading
  hold: StanceHold | null
  diagnostics: Diagnostics
  swings: RealTimeSwing[]
  cues: { at: number; cue: SwingCue }[]
}

function thousandths(value: number) {
  return roundedNumber('', value) as number
}

/** Where the grip is (a share of the picture's width) with the hands `offset` SW from the midline. */
function gripShare(offset: number) {
  return thousandths(0.5 + offset * 0.15)
}

/** The pose task's landmarks for both hands together `offset` SW from the midline, raised to the chest. */
function landmarksAt(offset: number): NormalizedLandmark[] {
  const landmarks = Array.from({ length: 33 }, () => ({ x: 0, y: 0, z: 0, visibility: 0 }))
  const gripX = gripShare(offset)
  const placed: Record<keyof typeof SAVED_LANDMARK_INDEX, [number, number]> = {
    nose: [0.5, 0.2],
    leftShoulder: [0.575, 0.35],
    rightShoulder: [0.425, 0.35],
    leftElbow: [0.6, 0.5],
    rightElbow: [0.4, 0.5],
    leftWrist: [gripX + 0.002, 0.45],
    rightWrist: [gripX - 0.002, 0.45],
    leftHip: [0.55, 0.75],
    rightHip: [0.45, 0.75],
  }
  Object.entries(placed).forEach(([name, [x, y]]) => {
    landmarks[SAVED_LANDMARK_INDEX[name as keyof typeof SAVED_LANDMARK_INDEX]] = {
      x: thousandths(x),
      y: thousandths(y),
      z: 0,
      visibility: 0.9,
    }
  })
  return landmarks
}

function poseResult(offset: number | null): PoseLandmarkerResult {
  return { landmarks: offset === null ? [] : [landmarksAt(offset)], worldLandmarks: [], close: () => undefined }
}

/**
 * The page's camera, its pose task and object detector run through the diagnostics as a dev build runs them; the
 * detector is not at hand yet (still loading).
 */
async function openCamera(): Promise<Session> {
  const diagnostics = createDiagnostics()
  const scene: Scene = { offset: null, energy: QUIET }
  const parts = diagnosedCameraParts(
    {
      start: async () => ({ noteMovement: () => undefined }),
      createTracker: async () => ({ detect: () => poseResult(scene.offset), close: () => undefined }),
      createObjectDetector: async () => ({ detect: () => BOTTLE_AT_THE_LOAD, close: () => undefined }),
    },
    diagnostics,
  )
  const [pose, detector] = await Promise.all([parts.createTracker(), parts.createObjectDetector()])
  const reading = newReading(scene)
  return { scene, time: 1000, pose, detector, objects: null, reading, hold: null, diagnostics, swings: [], cues: [] }
}

function newReading(scene: Scene): SwingReading {
  const energy = { measure: () => scene.energy, clear: () => undefined }
  return { tracker: createSwingTracker('left'), energy, objectsRanAt: -Infinity }
}

/** One camera frame of `scene` handled as the page handles it (cameraTracking.ts), while `wait` waits or none does. */
function frame(session: Session, scene: Scene, wait: StanceWait | null) {
  session.time += FRAME_MS
  Object.assign(session.scene, scene)
  const pose = poseFrame(session.pose.detect(video, session.time), ASPECT, session.time)
  const { swing, detections } = readSwingFrame(session.reading, pose, video, session.objects, false)
  if (swing) session.swings.push(swing)
  const { tracker } = session.reading
  if (tracker.cue) session.cues.push({ at: session.time, cue: tracker.cue })
  const stance = stanceFrame(tracker, session.time)
  session.hold = followStance(session.hold, wait, stance)
  const handled = { frame: pose, poseMs: 12, video, tracker, detections, swing, stance, hold: session.hold }
  diagnoseFrame(handled, session.diagnostics, session.time + 20)
}

function frames(session: Session, count: number, scene: Scene, wait: StanceWait | null = null) {
  Array.from({ length: count }, () => frame(session, scene, wait))
}

/** A tap on the hands at the load, between two frames, as the camera panel hands it to the page. */
function tapTheHands(session: Session) {
  const point = { x: thousandths(gripShare(LOAD) * ASPECT), y: 0.45 }
  diagnoseTap(point, session.diagnostics, session.time + 25)
  lockByHand(session.reading.tracker, point)
}

/**
 * The setup with no object detector at hand, the hands held still at the load until the tracker plays free mode and
 * the stance fills; a swing across the body in practice; then the camera turned off and on, its detector ready, the
 * visitor back at the load with a bottle it locks, and a tap on the hands that locks them by hand instead.
 */
async function playedSession() {
  const session = await openCamera()
  frames(session, 220, { offset: LOAD, energy: QUIET }, SETUP)
  Array.from({ length: 6 }, (_, index) => frame(session, { offset: LOAD - 0.25 * (index + 1), energy: LOUD }, null))
  frames(session, 10, { offset: -0.9, energy: QUIET })
  forgetDiagnosedCamera(session.diagnostics)
  Object.assign(session, { reading: newReading(session.scene), hold: null, objects: session.detector })
  frames(session, 15, { offset: LOAD, energy: QUIET })
  tapTheHands(session)
  frames(session, 10, { offset: LOAD, energy: QUIET })
  return session
}

/** What the page made of each frame, from the saved notes. */
function notedFrames(notes: readonly FrameNote[]) {
  return notes.map((note) => [
    note.state,
    note.lock?.kind ?? null,
    note.stance?.need ?? null,
    note.stance?.heldMs ?? null,
  ])
}

describe('a saved diagnostics log replayed', () => {
  it('plays the session the page saw again, from the saved file alone', async () => {
    const session = await playedSession()
    const log = JSON.parse(diagnosticsLogText(session.diagnostics, new Date(0)))
    const replayed = replayDiagnosticsLog(log)
    const made = replayed.map((replay) => [
      replay.state,
      replay.lock,
      replay.stance?.need ?? null,
      replay.stance?.heldMs ?? null,
    ])
    expect(made).toEqual(notedFrames(log.frames))
    // Free mode with no detector at hand, the setup's gauge filled, one swing; the bottle, then the tap, next camera.
    expect(new Set(replayed.map((replay) => replay.lock))).toEqual(new Set([null, 'free', 'detected', 'manual']))
    expect(Math.max(...replayed.map((replay) => replay.stance?.heldMs ?? 0))).toBe(STANCE_HOLD_RULES.holdMs)
    expect(session.swings).toHaveLength(1)
    // The same swing: its moments, its speed, and the bat's height, which the picture's aspect scales.
    const swings = replayed.flatMap((replay) => (replay.swing ? [replay.swing] : []))
    const heard = session.swings.map(({ contactAtRealMs, startedAtRealMs, speed, batHeight }) => ({
      contactAtMs: contactAtRealMs,
      startedAtMs: startedAtRealMs,
      speed,
      batHeight,
    }))
    expect(swings).toEqual(heard)
    // The swing's start cued on the same frame as on the page.
    const cues = replayed.flatMap((replay) => (replay.cue ? [{ at: replay.capturedAt, cue: replay.cue }] : []))
    expect(session.cues.map(({ cue }) => cue.kind)).toContain('started')
    expect(cues).toEqual(session.cues)
  })

  it('plays it through the rules as they are now, not as they were when it was saved', async () => {
    const log = JSON.parse(diagnosticsLogText((await playedSession()).diagnostics, new Date(0)))
    const saved = { swing: { ...SWING_RULES }, stance: { ...STANCE_HOLD_RULES } }
    try {
      // A swing must be far faster, and the stance's grip up by the shoulders.
      Object.assign(SWING_RULES, { swingSpeed: 20 })
      Object.assign(STANCE_HOLD_RULES, { lowestGrip: 0 })
      const replayed = replayDiagnosticsLog(log)
      expect(replayed.filter((replay) => replay.swing)).toEqual([])
      expect(replayed.map((replay) => replay.stance?.heldMs ?? 0)).not.toContain(STANCE_HOLD_RULES.holdMs)
      expect(replayed.map((replay) => replay.stance?.need)).toContain('raise')
    } finally {
      Object.assign(SWING_RULES, saved.swing)
      Object.assign(STANCE_HOLD_RULES, saved.stance)
    }
  })
})
