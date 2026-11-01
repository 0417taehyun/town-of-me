import type { FrameNote, GameEventNote, TapNote } from './devDiagnostics'
import { followStance, stanceFrame, type StanceHold } from './flow/stanceHold'
import type { HeldObjectLock } from './vision/heldObject'
import { bodySample } from './vision/poseLandmarks'
import {
  createSwingTracker,
  lockByHand,
  type SwingCue,
  type SwingTracker,
  type TrackedSwing,
  type TrackerState,
  updateSwingTracker,
} from './vision/swingTracker'

// Dev tuning only: a session L saved (devDiagnostics.ts) fed back through the swing tracker and the stance hold, frame
// by frame, as their rules are now, so a real webcam session can be played again after SWING_RULES, STANCE_HOLD_RULES
// or HELD_OBJECT_RULES change, and its swings, locks, and held stances compared with the notes the page took. Each
// frame gives the tracker what the page gave it: the pose, what the object detector handed it, and the motion the page
// measured in the band its tracker set then, which no replay can measure again (the file holds no picture), so rules
// that move the band replay that motion where it was. A tap on the camera picture locks by hand before the next frame,
// as it did on the page; the stance hold follows the step that waited then, and a frame of the next camera starts both
// afresh, as the page does. What the replay cannot do: the detector reported only held-object labels at least as sure
// as the dev build's DEV_DETECTOR_SCORE (vision/tasksVision.ts), so a lower `candidateScore` than that, or another
// label, finds nothing more; the file keeps three decimals, so a frame near a rule's limit can go the other way; and a
// file that starts mid-session (L keeps the last minute) starts from a fresh tracker and hold, so its first seconds
// differ from the notes until the replay has locked as the page had; nor is the dev seam's stand-in visitor
// (devSeam.ts) in the file. Nothing in the app imports this module, so no build carries it; a test or a scratch script
// parses a saved file and hands it over.

/** What a frame's note gives its replay. */
export type ReplayableFrame = Pick<
  FrameNote,
  | 'capturedAt'
  | 'handledAt'
  | 'camera'
  | 'pose'
  | 'objects'
  | 'width'
  | 'height'
  | 'side'
  | 'wait'
  | 'energy'
  | 'moving'
>

/** What a saved log gives its replay: the frames, and the events among which the taps lock by hand. */
export type ReplayableLog = { frames: readonly ReplayableFrame[]; events: readonly (GameEventNote | TapNote)[] }

/**
 * What the replay made of a frame: the tracker's state and the kind of its lock, the swing the frame completed and
 * what it cued the stage, and the stance hold's need and gauge (null while no step waited).
 */
export type ReplayedFrame = {
  capturedAt: number
  state: TrackerState
  lock: HeldObjectLock['kind'] | null
  swing: TrackedSwing | null
  cue: SwingCue | null
  stance: Pick<StanceHold, 'need' | 'heldMs'> | null
}

/**
 * The camera being replayed (null before the first frame), its tracker, the stance hold, and the taps not yet
 * replayed, in the order they came.
 */
export type Replay = { camera: number | null; tracker: SwingTracker; hold: StanceHold | null; taps: TapNote[] }

/** Each frame of a saved log replayed, in order. */
export function replayDiagnosticsLog({ frames, events }: ReplayableLog): ReplayedFrame[] {
  const taps = events.flatMap((event) => (event.type === 'tap' ? [event] : []))
  const replay: Replay = { camera: null, tracker: createSwingTracker('right'), hold: null, taps }
  return frames.map((frame) => replayFrame(replay, frame))
}

export function replayFrame(replay: Replay, frame: ReplayableFrame): ReplayedFrame {
  if (frame.camera !== replay.camera) {
    Object.assign(replay, { camera: frame.camera, tracker: createSwingTracker('right'), hold: null })
  }
  const { tracker } = replay
  replayTapsBefore(replay, frame.handledAt)
  const time = frame.capturedAt
  tracker.side = frame.side
  const body = frame.pose && bodySample(frame.pose, frame.width / frame.height)
  const energy = { value: frame.energy, moving: frame.moving }
  const swing = updateSwingTracker(tracker, { time, body, detections: frame.objects, energy })
  const hold = followStance(replay.hold, frame.wait, stanceFrame(tracker, time))
  replay.hold = hold
  return {
    capturedAt: time,
    state: tracker.state,
    lock: tracker.lock?.kind ?? null,
    swing,
    cue: tracker.cue,
    stance: hold && { need: hold.need, heldMs: hold.heldMs },
  }
}

/** Locks by hand at each tap the page heard before it handled a frame at `handledAt`, as the page's tracker did. */
export function replayTapsBefore(replay: Replay, handledAt: number) {
  const due = replay.taps.filter((tap) => tap.handledAt < handledAt)
  replay.taps = replay.taps.slice(due.length)
  due.forEach((tap) => lockByHand(replay.tracker, tap.point))
}
