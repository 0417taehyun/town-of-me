import { describe, expect, it } from 'vitest'
import {
  bestCandidate,
  cameraSummary,
  createDiagnostics,
  diagnoseFrame,
  diagnoseStageEvent,
  type Diagnostics,
  type FrameNote,
  forgetDiagnosedCamera,
} from './devDiagnostics'
import type { RealTimeSwing, StageEvent } from './stage/stageRun'
import type { HeldObjectLabel } from './vision/heldObject'
import { createSwingTracker, type Side, type Sweep, type SwingTracker, type TrackerView } from './vision/swingTracker'

const video = { videoWidth: 640, videoHeight: 480 }

/** The grip as the tracker sees it mid-sweep, both wrists in view. */
const SEEN_GRIP: TrackerView = {
  wrists: { left: { x: 0.5, y: 0.5 }, right: { x: 0.5, y: 0.5 } },
  head: null,
  grip: { x: 0.5, y: 0.5 },
  source: 'both',
  width: 0.2,
  midX: 0.5,
}

/** The page handles each frame this long (ms) after the camera took it. */
const HANDLING_MS = 20

/** Notes a frame taken at `capturedAt` of a tracker as it is, which reported `swing` or none. */
function noteFrame(
  diagnostics: Diagnostics,
  tracker: SwingTracker,
  capturedAt: number,
  swing: RealTimeSwing | null = null,
) {
  const stance = { time: capturedAt, pose: 'show' as const, grip: null, shoulderWidth: null }
  const frame = { keypoints: null, body: null, capturedAt }
  diagnoseFrame({ frame, poseMs: 12, video, tracker, swing, stance, hold: null }, diagnostics, capturedAt + HANDLING_MS)
}

/** The swing a frame reports for a sweep that crossed the midline at `crossTime`, 110 ms after leaving the load. */
function swingAt(crossTime: number): RealTimeSwing {
  return { contactAtRealMs: crossTime, startedAtRealMs: crossTime - 110, speed: 8, batHeight: 0.5 }
}

/** A sweep from a load on `side` past the midline: fast, long, and lit up enough to be a swing unless `measured` says. */
function sweepFrom(side: Side, measured: Partial<Sweep> = {}): Sweep {
  const grip = { x: 0.5, y: 0.5 }
  return {
    arm: { side, depth: 0.5, time: 0, grip, deepest: { depth: 0.5, grip, time: 0 } },
    startedAt: 0,
    from: grip,
    head: null,
    startDepth: 0.5,
    previousDepth: -0.3,
    previousTime: 0,
    lastGrip: grip,
    crossTime: null,
    crossY: null,
    minimumDepth: -0.3,
    travel: 1,
    headShift: 0,
    peak: 8,
    velocity: -6,
    energy: 5,
    moving: 0.1,
    ...measured,
  }
}

/** Follows `sweep`, the grip in view, on two frames from `fromMs`. */
function followSweep(diagnostics: Diagnostics, tracker: SwingTracker, sweep: Sweep, fromMs: number) {
  tracker.view = SEEN_GRIP
  tracker.sweep = sweep
  noteFrame(diagnostics, tracker, fromMs)
  noteFrame(diagnostics, tracker, fromMs + 33)
}

/** Sees the sweep end on a frame at `atMs` that shows the grip as `view` and reports `swing` or none. */
function endSweep(
  diagnostics: Diagnostics,
  tracker: SwingTracker,
  atMs: number,
  swing: RealTimeSwing | null,
  view: TrackerView | null = SEEN_GRIP,
) {
  tracker.view = view
  tracker.sweep = null
  noteFrame(diagnostics, tracker, atMs, swing)
}

/** Follows `sweep` on two frames from `fromMs` and sees it end on the next one, which reports `swing` or none. */
function sweepEnds(
  diagnostics: Diagnostics,
  tracker: SwingTracker,
  sweep: Sweep,
  fromMs: number,
  swing: RealTimeSwing | null = null,
) {
  followSweep(diagnostics, tracker, sweep, fromMs)
  endSweep(diagnostics, tracker, fromMs + 66, swing)
}

/** A frame note handled at `handledAt` with the pose and the object detector's times. */
function timedNote(handledAt: number, poseMs: number, objectsMs: number | null): FrameNote {
  return {
    capturedAt: handledAt - HANDLING_MS,
    handledAt,
    poseMs,
    objectsMs,
    state: 'locked',
    reason: null,
    lock: null,
    sightings: 0,
    candidate: null,
    grip: null,
    speed: 0,
    energy: 0,
    moving: 0,
    noise: null,
    stance: null,
  }
}

describe('the camera diagnostics', () => {
  it('rates the camera and the vision tasks over the last two seconds only', () => {
    // A slow start at 15 fps, then two seconds at 30 fps with the object detector every 250 ms.
    const slow = Array.from({ length: 30 }, (_, index) => timedNote(index * (1000 / 15), 40, 120))
    const fast = Array.from({ length: 60 }, (_, index) =>
      timedNote(2000 + (index + 1) * (1000 / 30), 10, index % 8 === 0 ? 50 : null),
    )
    const summary = cameraSummary([...slow, ...fast], 4000)
    expect(summary.fps).toBeCloseTo(30, 0)
    expect([summary.poseMs, summary.objectsMs, summary.objectsPerSecond]).toEqual([10, 50, 4])
    expect(summary.latencyMs).toBe(HANDLING_MS)
  })

  it('keeps only the last minute of frames and sweeps to save', () => {
    const diagnostics = createDiagnostics()
    const tracker = createSwingTracker('right')
    sweepEnds(diagnostics, tracker, sweepFrom(-1), 0)
    expect(diagnostics.sweeps).toHaveLength(1)
    Array.from({ length: 70 * 30 }, (_, index) => 100 + index * (1000 / 30)).forEach((capturedAt) =>
      noteFrame(diagnostics, tracker, capturedAt),
    )
    const handled = diagnostics.frames.map((note) => note.handledAt)
    const lastHandled = handled[handled.length - 1]
    expect(lastHandled - handled[0]).toBeLessThanOrEqual(60000)
    expect(handled.length).toBeGreaterThan(59 * 30)
    expect(diagnostics.sweeps).toEqual([])
  })

  it('times each swing from its crossing to the stage judging it, and keeps no sweep of the bat coming back', () => {
    const diagnostics = createDiagnostics()
    // A right-handed batter loads on the image's left.
    const tracker = createSwingTracker('right')
    // One swing between pitches, which the stage never judges, then one at a pitch.
    sweepEnds(diagnostics, tracker, sweepFrom(-1, { startedAt: 900, crossTime: 1010 }), 1000, swingAt(1010))
    sweepEnds(diagnostics, tracker, sweepFrom(-1, { startedAt: 2900, crossTime: 3010 }), 3000, swingAt(3010))
    const result = { outcome: 'hit', distanceDecimetres: 600, spray: 0, launchDegrees: 20 } as const
    const judged: StageEvent = {
      type: 'result',
      pitchIndex: 0,
      result: { ...result, pitchType: 'fastball', timing: 'good', errorMs: -12 },
      swing: { contactMs: 400, startedMs: 290, speed: 8, heightError: 0 },
    }
    diagnoseStageEvent(judged, diagnostics, 3100)
    // The bat coming back toward the far side, and pose wobble that never left the load, are no sweeps to keep.
    sweepEnds(diagnostics, tracker, sweepFrom(1), 3500)
    sweepEnds(diagnostics, tracker, sweepFrom(-1, { minimumDepth: 0.2 }), 4000)
    expect(diagnostics.sweeps).toHaveLength(2)
    const [between, atPitch] = diagnostics.sweeps
    const crossing = atPitch.crossedAt ?? 0
    const reported = atPitch.reported ?? { capturedAt: 0, handledAt: 0 }
    const times = [atPitch.leftLoadAt, reported.capturedAt, reported.handledAt, atPitch.stage?.at ?? 0]
    expect(times.map((at) => at - crossing)).toEqual([-110, 56, 76, 90])
    expect([between.stage, atPitch.stage?.timing]).toEqual([null, 'good'])
  })

  it('names the rules a sweep toward the batting side had not met when it ended', () => {
    const diagnostics = createDiagnostics()
    const tracker = createSwingTracker('right')
    sweepEnds(diagnostics, tracker, sweepFrom(-1, { crossTime: 1010, peak: 2, headShift: 0.8 }), 1000)
    sweepEnds(diagnostics, tracker, sweepFrom(-1, { crossTime: null }), 2000)
    expect(diagnostics.sweeps.map((sweep) => [sweep.swing, sweep.failures])).toEqual([
      [false, ['speed', 'body']],
      [false, ['cross']],
    ])
  })

  it('tells a swing the dropout rules judged, and a crossing they predicted, from a swing seen to the end', () => {
    const diagnostics = createDiagnostics()
    const tracker = createSwingTracker('right')
    // Short and slow by the rules for a grip seen to the end, but closing fast when the wrists blurred out.
    const dropout = { travel: 0.5, peak: 3.5, velocity: -5 }
    // Lost before the crossing, which the tracker predicts on the frame it reports the swing.
    const blurred = sweepFrom(-1, { startedAt: 900, ...dropout })
    followSweep(diagnostics, tracker, blurred, 1000)
    blurred.crossTime = 1080
    endSweep(diagnostics, tracker, 1066, swingAt(1080), null)
    // Lost just after a crossing it saw.
    followSweep(diagnostics, tracker, sweepFrom(-1, { startedAt: 1900, crossTime: 2020, ...dropout }), 2000)
    endSweep(diagnostics, tracker, 2066, swingAt(2020), { ...SEEN_GRIP, source: 'hold' })
    sweepEnds(diagnostics, tracker, sweepFrom(-1, { startedAt: 2900, crossTime: 3050 }), 3000, swingAt(3050))
    const notes = diagnostics.sweeps.map((sweep) => [sweep.gripLost, sweep.crossingPredicted, sweep.failures])
    expect(notes).toEqual([
      [true, true, []],
      [true, false, []],
      [false, false, []],
    ])
  })

  it('forgets the sweep it followed once the camera turns off, so the next camera starts with none', () => {
    const diagnostics = createDiagnostics()
    followSweep(diagnostics, createSwingTracker('right'), sweepFrom(-1, { startedAt: 900 }), 1000)
    forgetDiagnosedCamera(diagnostics)
    noteFrame(diagnostics, createSwingTracker('right'), 40000)
    expect(diagnostics.sweeps).toEqual([])
  })

  it('names the detection the tracker would lock first, or else the nearest one', () => {
    // Image units (x scaled by a 4:3 aspect): shoulders 0.2 apart, both hands at (0.55, 0.57).
    const hands = {
      wrists: { left: { x: 0.56, y: 0.57 }, right: { x: 0.54, y: 0.57 } },
      grip: { x: 0.55, y: 0.57 },
      width: 0.2,
    }
    /** A detection `x` across the image (as a share of its width), from the shoulders down. */
    const foundAt = (label: HeldObjectLabel, score: number, x: number) => ({
      label,
      score,
      box: { x, y: 0.3, width: 0.06, height: 0.3 },
    })
    const inHands = foundAt('bottle', 0.5, 0.39)
    const byHands = foundAt('cell phone', 0.9, 0.45)
    const farAway = foundAt('umbrella', 0.95, 0.05)
    expect(bestCandidate([inHands, byHands, farAway], hands, 4 / 3)?.label).toBe('cell phone')
    expect(bestCandidate([farAway, { ...byHands, score: 0.2 }], hands, 4 / 3)?.label).toBe('cell phone')
  })
})
