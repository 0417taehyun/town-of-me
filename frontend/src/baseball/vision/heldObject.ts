import type { ObjectDetectorResult } from '@mediapipe/tasks-vision'
import {
  type BodySample,
  type Box,
  distance,
  gripOf,
  type Hand,
  meanPoint,
  type Point,
  visibleWrists,
} from './poseLandmarks'

// What the visitor swings: a held object the object detector finds next to their still hands, locked by itself once
// enough sightings agree and then trusted; none at all in free mode, which a visitor whose object the detector cannot
// find plays (as a tap on the camera picture can point one out by hand). Detectors lose thin, blurred objects
// mid-swing, so a swing is judged from the pose and the lock's geometry (swingTracker.ts), never from a detection
// during it; the detector only keeps the lock fresh between swings and lets it go once the object is gone, when free
// mode takes over until a real object locks again. Everything is in the raw, unmirrored image with x scaled by its
// aspect ratio (poseLandmarks.ts); lengths are in the body's shoulder widths.

/**
 * COCO labels a visitor might plausibly swing or hold. A person is never the held object, and neither is a remote: in
 * the drafts' real webcam log the detector boxed the visitor's empty hands as one through the minute (57 sightings sure
 * enough and within reach of a wrist, 21 of them before the bottle first showed), which would have locked in place of
 * the hands. A phone and a mouse are left out with it, as the same kind of small thing nobody swings.
 */
export const HELD_OBJECT_LABELS = [
  'baseball bat',
  'baseball glove',
  'sports ball',
  'tennis racket',
  'bottle',
  'cup',
  'wine glass',
  'umbrella',
  'banana',
  'toothbrush',
  'scissors',
  'spoon',
  'fork',
  'book',
  'teddy bear',
  'frisbee',
  'hair drier',
  'vase',
] as const

export type HeldObjectLabel = (typeof HELD_OBJECT_LABELS)[number]

export function isHeldObjectLabel(label: string): label is HeldObjectLabel {
  return (HELD_OBJECT_LABELS as readonly string[]).includes(label)
}

/**
 * Checked against the drafts' one real webcam log (2026-10-31-real-webcam-1.json): a held bottle locked within 0.3 s
 * of coming within `candidateReach` of a wrist, and a lower `candidateScore` would have locked a 0.27 "cup" by the
 * wrists in its place. The detector boxes a held bottle above the fist, so its box keeps some way off the wrist: 39 of
 * the log's 41 sightings sure enough were within 1 SW of one, only 17 within 0.6. A visitor whose object the detector
 * cannot find (it seldom finds a bat) plays in free mode.
 */
export const HELD_OBJECT_RULES = {
  /** A detection less sure than this, or farther than `candidateReach` from a wrist, is not what the hands hold. */
  candidateScore: 0.35,
  candidateReach: 1,
  /** A lock takes `lockHits` sightings of one place, overlapping by `lockOverlap` (IoU), within `lockWindowMs`. */
  lockHits: 3,
  lockWindowMs: 1000,
  lockOverlap: 0.4,
  /** A detected object unseen `lostMisses` times in a row, for over `lostAfterMs`, while the hands are still, is gone. */
  lostMisses: 6,
  lostAfterMs: 1500,
  /**
   * Looking this long from when the hands came into view, with nothing locked and nothing by the hands, a still visitor
   * plays free from the detector's next run that finds nothing (swingTracker.ts handsOnlyDue).
   */
  handsOnlyAfterMs: 2000,
  /**
   * What the detector found by the hands, unseen by any run for this long (it rests through a pitch, and runs seldom in
   * free mode), is gone, so its box never stays marked where nothing has been seen since.
   */
  candidateFreshMs: 300,
  /** Wrists this close together hold the object together. */
  twoHands: 0.6,
  /** With no object, a hand-held stick this long, pointing up, stands in for one. */
  freeLength: 1.2,
  /** A tap this close to the grip means the thing in the hands, taken to point up like a held bat `heldLength` long. */
  onHands: 0.3,
  heldLength: 1.5,
  /** A tap farther than this from the grip is not on anything the hands hold. */
  manualReach: 3,
  /** The margin around a stick drawn from the grip to its tip. */
  boxMargin: 0.12,
  /** How much each fresh sighting moves the object's length. */
  refreshWeight: 0.3,
}

/**
 * How long (ms) the object detector waits between runs: briefly while looking for an object, longer to keep a locked
 * one fresh, and longest in free mode with nothing by the hands (swingTracker.ts objectDetectionInterval).
 */
export const OBJECT_DETECTION_INTERVAL_MS = { searching: 110, locked: 250, handsOnly: 1000 }

/** One object the detector found: what it is, how sure the detector is, and its box as shares of the image. */
export type Detection = { label: HeldObjectLabel; score: number; box: Box }

/** A detection in image units, and how far (shoulder widths) it is from the nearest visible wrist. */
export type MeasuredDetection = Detection & { imageBox: Box; reach: number }

/** The hands as the lock sees them: the wrists, the grip followed, and the body's frozen shoulder width. */
export type HandsView = { wrists: BodySample['wrists']; grip: Point; width: number }

/**
 * A locked object: found by the detector (with what it took it for), pointed out by hand, or none (free mode); the
 * hand that holds it, its box and the grip it was last seen at, its length from the grip to its tip (shoulder widths),
 * and how often and since when the detector has missed it.
 */
export type HeldObjectLock = {
  kind: 'detected' | 'manual' | 'free'
  label: HeldObjectLabel | null
  hand: Hand
  box: Box
  grip: Point
  length: number
  misses: number
  missingSince: number | null
}

/** Recent sightings of the best object next to the hands, and how many of them overlap the newest. */
export type LockSearch = { sightings: { time: number; box: Box }[]; progress: number }

export const NO_SEARCH: LockSearch = { sightings: [], progress: 0 }

/** The held objects in a detector `result` for an image `width` by `height` pixels; a person is never one. */
export function objectDetections(result: ObjectDetectorResult, width: number, height: number): Detection[] {
  if (!width || !height) return []
  return result.detections.flatMap((detection) => heldDetection(detection, width, height))
}

export function heldDetection(
  detection: ObjectDetectorResult['detections'][number],
  width: number,
  height: number,
): Detection[] {
  const category = detection.categories.at(0)
  const label = category?.categoryName ?? ''
  const box = detection.boundingBox
  if (!category || !box || !isHeldObjectLabel(label)) return []
  return [
    {
      label,
      score: category.score,
      box: { x: box.originX / width, y: box.originY / height, width: box.width / width, height: box.height / height },
    },
  ]
}

export function toImageBox(box: Box, aspect: number): Box {
  return { x: box.x * aspect, y: box.y, width: box.width * aspect, height: box.height }
}

/** How far `point` is from `box` (0 inside it), in the same units. */
export function boxDistance(box: Box, point: Point) {
  const outsideX = Math.max(box.x - point.x, 0, point.x - (box.x + box.width))
  const outsideY = Math.max(box.y - point.y, 0, point.y - (box.y + box.height))
  return Math.hypot(outsideX, outsideY)
}

export function intersectionOverUnion(first: Box, second: Box) {
  const width = Math.min(first.x + first.width, second.x + second.width) - Math.max(first.x, second.x)
  const height = Math.min(first.y + first.height, second.y + second.height) - Math.max(first.y, second.y)
  if (width <= 0 || height <= 0) return 0
  const overlap = width * height
  return overlap / (first.width * first.height + second.width * second.height - overlap)
}

/** The corner of `box` farthest from `point`: where an object held at `point` ends. */
export function farthestCorner(box: Box, point: Point): Point {
  const corners = [
    { x: box.x, y: box.y },
    { x: box.x + box.width, y: box.y },
    { x: box.x, y: box.y + box.height },
    { x: box.x + box.width, y: box.y + box.height },
  ]
  return corners.reduce((farthest, corner) => (distance(corner, point) > distance(farthest, point) ? corner : farthest))
}

/** Which hand holds the object in `box`: both if the wrists are together, else the one nearest it. */
export function chooseHand(wrists: BodySample['wrists'], shoulderWidth: number, box: Box): Hand {
  const { left, right } = wrists
  if (!left || !right) return left ? 'left' : right ? 'right' : 'both'
  if (distance(left, right) <= HELD_OBJECT_RULES.twoHands * shoulderWidth) return 'both'
  return boxDistance(box, left) <= boxDistance(box, right) ? 'left' : 'right'
}

/** `detection` in image units, with its reach to the nearest visible wrist (Infinity when none is visible). */
export function measureDetection<Found extends Detection>(
  detection: Found,
  view: HandsView,
  aspect: number,
): Found & MeasuredDetection {
  const imageBox = toImageBox(detection.box, aspect)
  const reaches = visibleWrists(view.wrists).map((wrist) => boxDistance(imageBox, wrist) / view.width)
  return { ...detection, imageBox, reach: Math.min(...reaches) }
}

/** The detections sure enough and close enough to the hands to be what they hold, surest first. */
export function lockCandidates<Found extends Detection>(detections: readonly Found[], view: HandsView, aspect: number) {
  const { candidateScore, candidateReach } = HELD_OBJECT_RULES
  return detections
    .map((detection) => measureDetection(detection, view, aspect))
    .filter((detection) => detection.score >= candidateScore && detection.reach <= candidateReach)
    .sort((first, second) => second.score - first.score)
}

/**
 * `search` after a sighting of `box` at `time`: sightings older than the lock window drop out, and the progress is how
 * many of the rest overlap this one. The object locks once the progress reaches `lockHits`.
 */
export function searchForLock(search: LockSearch, box: Box, time: number): LockSearch {
  const recent = search.sightings.filter((sighting) => time - sighting.time <= HELD_OBJECT_RULES.lockWindowMs)
  const sightings = [...recent, { time, box }]
  return { sightings, progress: agreeingSightings(sightings, box, time).length }
}

/** The sightings within the lock window before `time` that overlap `box` enough to be the same object. */
export function agreeingSightings(sightings: LockSearch['sightings'], box: Box, time: number) {
  const { lockWindowMs, lockOverlap } = HELD_OBJECT_RULES
  return sightings.filter(
    (sighting) => time - sighting.time <= lockWindowMs && intersectionOverUnion(sighting.box, box) >= lockOverlap,
  )
}

/** How far a lock on `box` has come by `time` (0..1): the recent sightings agreeing with it, of `lockHits` needed. */
export function lockProgress(search: LockSearch, box: Box, time: number) {
  return Math.min(1, agreeingSightings(search.sightings, box, time).length / HELD_OBJECT_RULES.lockHits)
}

export function isLockedBy(search: LockSearch) {
  return search.progress >= HELD_OBJECT_RULES.lockHits
}

/** Whether `search` still has a sighting within the lock window at `time`, so a lock may yet come of it. */
export function isLockUnderWay(search: LockSearch, time: number) {
  return search.sightings.some((sighting) => time - sighting.time <= HELD_OBJECT_RULES.lockWindowMs)
}

/**
 * Locks `box` held in `view`'s hands, with no label (a detected lock adds its own); its tip is `tip`, or the box's
 * corner farthest from the grip. Free mode holds nothing to choose a hand by, so it follows both.
 */
export function lockOn(
  view: HandsView,
  box: Box,
  kind: HeldObjectLock['kind'],
  tip: Point | null = null,
): HeldObjectLock {
  const hand = kind === 'free' ? 'both' : chooseHand(view.wrists, view.width, box)
  const grip = gripOf(view.wrists, hand)?.point ?? view.grip
  const length = distance(tip ?? farthestCorner(box, grip), grip) / view.width
  return { kind, label: null, hand, box, grip, length, misses: 0, missingSince: null }
}

/** The box around a stick from `grip` to `tip`, with a margin, for a body `shoulderWidth` wide. */
export function boxAround(grip: Point, tip: Point, shoulderWidth: number): Box {
  const margin = HELD_OBJECT_RULES.boxMargin * shoulderWidth
  return {
    x: Math.min(tip.x, grip.x) - margin,
    y: Math.min(tip.y, grip.y) - margin,
    width: Math.abs(tip.x - grip.x) + 2 * margin,
    height: Math.abs(tip.y - grip.y) + 2 * margin,
  }
}

/**
 * Locks what the visitor tapped: `point` (image units) when it is near their hands, or the thing in their hands, taken
 * to point up, when `point` is on the hands. Null when no wrist shows or the point is too far from the hands.
 */
export function manualLock(view: HandsView, point: Point): HeldObjectLock | null {
  const wrists = visibleWrists(view.wrists)
  if (wrists.length === 0) return null
  const grip = meanPoint(wrists)
  const heldTip = { x: grip.x, y: grip.y - HELD_OBJECT_RULES.heldLength * view.width }
  const tip = distance(point, grip) >= HELD_OBJECT_RULES.onHands * view.width ? point : heldTip
  if (distance(tip, grip) > HELD_OBJECT_RULES.manualReach * view.width) return null
  return lockOn({ ...view, grip }, boxAround(grip, tip, view.width), 'manual', tip)
}

/**
 * Free mode: no object at all, so a stick in both hands, pointing up, stands in for one. The grip is where the wrists
 * meet, so arms hanging at the sides read as no load at all, rather than whichever wrist is a hair higher.
 */
export function freeLock(view: HandsView): HeldObjectLock {
  const grip = gripOf(view.wrists, 'both')?.point ?? view.grip
  const tip = { x: grip.x, y: grip.y - HELD_OBJECT_RULES.freeLength * view.width }
  return lockOn(view, boxAround(grip, tip, view.width), 'free', tip)
}

/** A box seen in the hands at `grip`, moved along with them since: where the object is now. */
export function currentBox(seen: Pick<HeldObjectLock, 'box' | 'grip'>, grip: Point): Box {
  return { ...seen.box, x: seen.box.x + grip.x - seen.grip.x, y: seen.box.y + grip.y - seen.grip.y }
}

/**
 * A detected lock after a detector run at `time` that found `candidates`: refreshed by the one overlapping it most,
 * or missed once more when none is there while `watching` (a still visitor, not one mid-swing, whose blurred object
 * the detector is expected to lose). Null once it has been missed `lostMisses` times for over `lostAfterMs`: the
 * object is gone.
 */
export function refreshLock(
  lock: HeldObjectLock,
  candidates: readonly MeasuredDetection[],
  view: HandsView,
  time: number,
  watching: boolean,
): HeldObjectLock | null {
  const box = currentBox(lock, view.grip)
  const match = [...candidates].sort(
    (first, second) =>
      intersectionOverUnion(second.imageBox, box) - intersectionOverUnion(first.imageBox, box) ||
      second.score - first.score,
  )[0]
  if (match) return seenAgain(lock, match.imageBox, view)
  if (!watching) return lock
  const missed = { ...lock, misses: lock.misses + 1, missingSince: lock.missingSince ?? time }
  const { lostMisses, lostAfterMs } = HELD_OBJECT_RULES
  return missed.misses >= lostMisses && time - missed.missingSince > lostAfterMs ? null : missed
}

/** The lock seen again at `box` in `view`'s hands: its length eases toward the new sighting's. */
export function seenAgain(lock: HeldObjectLock, box: Box, view: HandsView): HeldObjectLock {
  const sightedLength = distance(farthestCorner(box, view.grip), view.grip) / view.width
  const weight = HELD_OBJECT_RULES.refreshWeight
  const length = lock.length * (1 - weight) + sightedLength * weight
  return { ...lock, box, grip: view.grip, length, misses: 0, missingSince: null }
}
