import type { ObjectDetectorResult } from '@mediapipe/tasks-vision'
import { describe, expect, it } from 'vitest'
import {
  HELD_OBJECT_RULES,
  type HandsView,
  type HeldObjectLock,
  isLockedBy,
  lockCandidates,
  lockOn,
  lockProgress,
  NO_SEARCH,
  objectDetections,
  refreshLock,
  searchForLock,
} from './heldObject'
import type { Box } from './poseLandmarks'

// Image units (x scaled by a 4:3 aspect); the visitor's shoulders are 0.2 apart and both hands hold at (0.55, 0.57).
const ASPECT = 4 / 3
const hands: HandsView = {
  wrists: { left: { x: 0.56, y: 0.57 }, right: { x: 0.54, y: 0.57 } },
  grip: { x: 0.55, y: 0.57 },
  width: 0.2,
}
const bottle: Box = { x: 0.51, y: 0.29, width: 0.08, height: 0.3 }

/** The detector's result for an image 640 by 480 pixels: boxes as shares of it, each with its label and score. */
function detected(...found: [string, number, Box][]): ObjectDetectorResult {
  return {
    detections: found.map(([categoryName, score, box]) => ({
      categories: [{ categoryName, score, index: 0, displayName: '' }],
      boundingBox: {
        originX: box.x * 640,
        originY: box.y * 480,
        width: box.width * 640,
        height: box.height * 480,
        angle: 0,
      },
      keypoints: [],
    })),
  }
}

/** `box` (image units) as shares of the 4:3 image. */
function imageBox(box: Box): Box {
  return { x: box.x / ASPECT, y: box.y, width: box.width / ASPECT, height: box.height }
}

/** `box` (image units) moved `by` across. */
function shifted(box: Box, by: number): Box {
  return { ...box, x: box.x + by }
}

/** Sightings of `boxes` at `times` (ms), in order. */
function searched(boxes: readonly Box[], times: readonly number[]) {
  return boxes.reduce((search, box, index) => searchForLock(search, box, times[index]), NO_SEARCH)
}

describe('the held object', () => {
  it('locks only on enough sightings of one place, all within the lock window', () => {
    const { lockHits, lockWindowMs } = HELD_OBJECT_RULES
    const steady = Array.from({ length: lockHits }, () => bottle)
    const quick = Array.from({ length: lockHits }, (_, index) => index * 100)
    expect(isLockedBy(searched(steady, quick))).toBe(true)
    expect(isLockedBy(searched(steady.slice(1), quick))).toBe(false)
    const slow = Array.from({ length: lockHits }, (_, index) => index * (lockWindowMs * 0.6))
    expect(isLockedBy(searched(steady, slow))).toBe(false)
    const wandering = steady.map((box, index) => shifted(box, index * box.width))
    expect(isLockedBy(searched(wandering, quick))).toBe(false)
    // The progress the camera panel shows counts only the recent sightings of that place.
    const almost = searched(steady.slice(1), quick)
    const lastSighting = quick[lockHits - 2]
    expect(lockProgress(almost, bottle, lastSighting)).toBeCloseTo((lockHits - 1) / lockHits, 9)
    expect(lockProgress(almost, shifted(bottle, bottle.width * 2), lastSighting)).toBe(0)
    expect(lockProgress(almost, bottle, quick[0] + lockWindowMs + 1)).toBeLessThan((lockHits - 1) / lockHits)
  })

  it('never takes a person, or anything a visitor would not swing, for the held object', () => {
    const imageBottle = imageBox(bottle)
    const found = objectDetections(
      detected(['person', 0.99, imageBottle], ['bottle', 0.8, imageBottle], ['car', 0.9, imageBottle]),
      640,
      480,
    )
    // Only the bottle's sighting is left.
    expect(found.map((detection) => detection.score)).toEqual([0.8])
    expect(found[0].box.x).toBeCloseTo(imageBottle.x, 9)
    const candidates = lockCandidates(found, hands, ASPECT)
    expect(candidates.map((candidate) => candidate.imageBox.x)).toEqual([expect.closeTo(bottle.x, 9)])
    const farAway = lockCandidates([{ ...found[0], box: { ...found[0].box, x: 0.05 } }], hands, ASPECT)
    expect(farAway).toEqual([])
  })

  it('lets a detected object go only after it is missed enough times for long enough while the visitor is still', () => {
    const { lostMisses, lostAfterMs } = HELD_OBJECT_RULES
    /** The lock after `times` detector runs `gapMs` apart that found nothing. */
    const missedEvery = (gapMs: number, times: number, watching = true) =>
      Array.from({ length: times }, (_, index) => (index + 1) * gapMs).reduce<HeldObjectLock | null>(
        (current, time) => current && refreshLock(current, [], hands, time, watching),
        lock,
      )
    const lock = lockOn(hands, bottle, 'detected')
    // Enough misses over just more than the time: gone.
    expect(missedEvery(lostAfterMs / (lostMisses - 1) + 1, lostMisses)).toBeNull()
    // One miss short, however long they take; or many, but all within the time; or none counted mid-swing.
    expect(missedEvery(lostAfterMs / (lostMisses - 2) + 1, lostMisses - 1)).not.toBeNull()
    expect(missedEvery(lostAfterMs / (lostMisses * 2), lostMisses * 2)).not.toBeNull()
    expect(missedEvery(lostAfterMs, lostMisses * 2, false)).toEqual(lock)
    const nearlyGone = missedEvery(lostAfterMs / (lostMisses - 2) + 1, lostMisses - 1)
    const sighting = lockCandidates(
      objectDetections(detected(['bottle', 0.8, imageBox(bottle)]), 640, 480),
      hands,
      ASPECT,
    )
    expect(nearlyGone && refreshLock(nearlyGone, sighting, hands, lostAfterMs * 2, true)).toMatchObject({
      misses: 0,
      missingSince: null,
    })
  })
})
