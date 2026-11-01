import { describe, expect, it, vi } from 'vitest'
import { TIER_MEASUREMENT } from './performanceTier'
import {
  CAPTURE_TIME_LIMIT_MS,
  createFrameHandler,
  frameCapturedAt,
  nextSight,
  type PoseFrame,
  SIGHT_HOLD_MS,
  type Sight,
  UNSEEN,
} from './poseLoop'

const MEASURED_FRAMES = TIER_MEASUREMENT.warmUpFrames + TIER_MEASUREMENT.measuredFrames

/** A visitor seen with both shoulders and the right wrist at `wristX` (image heights). */
function standing(wristX: number): PoseFrame {
  return {
    keypoints: null,
    body: {
      wrists: { left: null, right: { x: wristX, y: 0.6 } },
      shoulders: { width: 0.2, midX: 0.5, midY: 0.4 },
      head: null,
      aspect: 1,
    },
    capturedAt: 0,
  }
}

/** Feeds `frames` camera frames, each taking the pose task `inferenceMs` over two drawn frames `drawnMs` apart. */
function measure(frames: number, inferenceMs: number, drawnMs: number) {
  const tiers: unknown[] = []
  const handle = createFrameHandler({ noteMovement: () => undefined }, (tier) => tiers.push(tier))
  const timing = { inferenceMs, frameIntervalsMs: [drawnMs, drawnMs] }
  Array.from({ length: frames }, () => handle(standing(0.3), timing))
  return tiers
}

/** Whether the camera sees the visitor after frames at `times` (ms) that `seen` says show them or not. */
function sightAfter(frames: readonly [number, boolean][], start: Sight = UNSEEN) {
  return frames.reduce((sight, [time, seenNow]) => nextSight(sight, seenNow, time), start).seen
}

describe('the vision loop', () => {
  it('measures this computer once its frames are in, and reports a slow one as too slow, each once', () => {
    expect(measure(MEASURED_FRAMES - 1, 12, 16.7)).toEqual([])
    expect(measure(MEASURED_FRAMES * 2, 12, 16.7)).toEqual(['smooth'])
    expect(measure(MEASURED_FRAMES * 2, 60, 66.7)).toEqual([null])
  })

  it('keeps the camera on for a visitor who moves, not for one who stands still or walks away', () => {
    const noteMovement = vi.fn()
    const handle = createFrameHandler({ noteMovement }, () => undefined)
    const timing = { inferenceMs: 10, frameIntervalsMs: [16.7] }
    ;[standing(0.3), standing(0.31), { keypoints: null, body: null, capturedAt: 0 }, standing(0.3)].forEach((frame) =>
      handle(frame, timing),
    )
    expect(noteMovement).toHaveBeenCalledTimes(1)
    handle(standing(0.45), timing)
    expect(noteMovement).toHaveBeenCalledTimes(2)
  })

  it('holds whether it sees the visitor through a swing’s hidden shoulder, but not through a step out of view', () => {
    const seen: Sight = { seen: true, changingSince: null }
    const { lost, found } = SIGHT_HOLD_MS
    const hiddenForASwing: [number, boolean][] = [
      [0, false],
      [lost - 1, false],
      [lost, true],
      [lost + 1, false],
    ]
    expect(sightAfter(hiddenForASwing, seen)).toBe(true)
    expect(sightAfter([...hiddenForASwing, [2 * lost + 1, false]], seen)).toBe(false)
    expect(sightAfter([[0, true]])).toBe(false)
    expect(
      sightAfter([
        [0, true],
        [found - 1, false],
        [found, true],
      ]),
    ).toBe(false)
    expect(
      sightAfter([
        [0, true],
        [found, true],
      ]),
    ).toBe(true)
  })

  it('times a frame when the camera took it, not when it reached the page, unless that time is not believable', () => {
    expect(frameCapturedAt(5000, 4930)).toBe(4930)
    expect(frameCapturedAt(5000, undefined)).toBe(5000)
    expect(frameCapturedAt(5000, 5010)).toBe(5000)
    expect(frameCapturedAt(5000, 5000 - CAPTURE_TIME_LIMIT_MS)).toBe(5000)
  })
})
