import type { NormalizedLandmark } from '@mediapipe/tasks-vision'

// The pose task's landmarks reduced to what the swing reads, and the plain geometry of points, boxes, and the grip that
// the held object and the swing tracker share. Everything is in the raw, unmirrored camera image (the preview mirrors
// only when it draws), so the person's right hand is the one further left.

/** The BlazePose landmarks of the upper body; left and right are the person's own. */
export const POSE_KEYPOINT_INDEX = {
  nose: 0,
  leftShoulder: 11,
  rightShoulder: 12,
  leftElbow: 13,
  rightElbow: 14,
  leftWrist: 15,
  rightWrist: 16,
} as const

/**
 * How visible (0..1) both shoulders must be to give the body its scale and midline, a wrist to be followed, and the
 * nose to stand for the head.
 */
export const KEYPOINT_VISIBILITY = { shoulders: 0.5, wrist: 0.35, head: 0.5 }

export type KeypointName = keyof typeof POSE_KEYPOINT_INDEX

/** A landmark in image coordinates (0..1 of the width and height) with its visibility as `score`. */
export type Keypoint = { x: number; y: number; score: number }

export type Keypoints = Record<KeypointName, Keypoint | null>

export type Point = { x: number; y: number }

/** A box in image units (x scaled by the aspect), or as shares (0..1) of the image's width and height. */
export type Box = { x: number; y: number; width: number; height: number }

/** The hand that holds the object, or both together. */
export type Hand = 'left' | 'right' | 'both'

/** The shoulders' width, and the midpoint between them (image units). */
export type ShoulderLine = { width: number; midX: number; midY: number }

/**
 * One frame's body, in image units with x scaled by the aspect ratio so a distance means the same both ways: the
 * person's wrists (null when not visible), the shoulders (null unless both are visible), and the head (null when the
 * nose is not visible).
 */
export type BodySample = {
  wrists: { left: Point | null; right: Point | null }
  shoulders: ShoulderLine | null
  head: Point | null
  aspect: number
}

/** The upper-body keypoints of one detected pose's landmarks. */
export function poseKeypoints(landmarks: readonly NormalizedLandmark[]): Keypoints {
  const entries = Object.entries(POSE_KEYPOINT_INDEX).map(([name, index]) => [name, keypointAt(landmarks, index)])
  return Object.fromEntries(entries) as Keypoints
}

export function keypointAt(landmarks: readonly NormalizedLandmark[], index: number): Keypoint | null {
  const landmark = landmarks.at(index)
  return landmark ? { x: landmark.x, y: landmark.y, score: landmark.visibility } : null
}

export function isVisible(keypoint: Keypoint | null, visibility: number): keypoint is Keypoint {
  return keypoint !== null && keypoint.score >= visibility
}

/** The body in `keypoints` for an image `aspect` (width / height) wide, or null when no shoulders or wrist show. */
export function bodySample(keypoints: Keypoints, aspect: number): BodySample | null {
  const wrists = { left: wristPoint(keypoints.leftWrist, aspect), right: wristPoint(keypoints.rightWrist, aspect) }
  const shoulders = shoulderLine(keypoints, aspect)
  if (!shoulders && !wrists.left && !wrists.right) return null
  return { wrists, shoulders, head: imagePoint(keypoints.nose, KEYPOINT_VISIBILITY.head, aspect), aspect }
}

export function wristPoint(wrist: Keypoint | null, aspect: number): Point | null {
  return imagePoint(wrist, KEYPOINT_VISIBILITY.wrist, aspect)
}

/** `keypoint` in image units, or null when it is less visible than `visibility`. */
export function imagePoint(keypoint: Keypoint | null, visibility: number, aspect: number): Point | null {
  return isVisible(keypoint, visibility) ? { x: keypoint.x * aspect, y: keypoint.y } : null
}

export function shoulderLine({ leftShoulder, rightShoulder }: Keypoints, aspect: number): ShoulderLine | null {
  const { shoulders } = KEYPOINT_VISIBILITY
  if (!isVisible(leftShoulder, shoulders) || !isVisible(rightShoulder, shoulders)) return null
  return {
    width: Math.hypot((leftShoulder.x - rightShoulder.x) * aspect, leftShoulder.y - rightShoulder.y),
    midX: ((leftShoulder.x + rightShoulder.x) / 2) * aspect,
    midY: (leftShoulder.y + rightShoulder.y) / 2,
  }
}

/**
 * How far (image heights) a wrist or the shoulders' midline must move to count as the visitor moving, which keeps the
 * camera on (cameraInput.ts): well above a still person's tracking jitter, well below a step or a swing.
 */
export const MOVEMENT_THRESHOLD = 0.05

/**
 * Whether `body` moved from `reference`, the body when movement was last noted. A body coming into view moves; one
 * leaving it does not, so a visitor who walks away lets the camera turn off. Only points seen both times are compared,
 * so a joint flickering in and out of view is not movement.
 */
export function bodyMoved(reference: BodySample | null, body: BodySample | null) {
  if (!body) return false
  if (!reference) return true
  const shifts = [
    pointShift(reference.wrists.left, body.wrists.left),
    pointShift(reference.wrists.right, body.wrists.right),
    midlineShift(reference.shoulders, body.shoulders),
  ]
  return Math.max(...shifts) > MOVEMENT_THRESHOLD
}

/** How far a point moved, or 0 unless it was seen both times. */
export function pointShift(from: Point | null, to: Point | null) {
  return from && to ? distance(from, to) : 0
}

export function distance(from: Point, to: Point) {
  return Math.hypot(to.x - from.x, to.y - from.y)
}

/** The offset from `to` to `from`. */
export function minus(from: Point, to: Point): Point {
  return { x: from.x - to.x, y: from.y - to.y }
}

export function plus(from: Point, offset: Point): Point {
  return { x: from.x + offset.x, y: from.y + offset.y }
}

export function meanPoint(points: readonly Point[]): Point {
  const sum = points.reduce((total, point) => ({ x: total.x + point.x, y: total.y + point.y }), { x: 0, y: 0 })
  return { x: sum.x / points.length, y: sum.y / points.length }
}

export function visibleWrists(wrists: BodySample['wrists']) {
  return [wrists.left, wrists.right].filter((wrist): wrist is Point => wrist !== null)
}

/**
 * The grip followed: the holding hand's wrist, or for both hands the visible wrists averaged. Averaging a holding hand
 * with a free hand at the hip would halve every distance and speed, so a one-handed hold follows that hand alone. The
 * source names what the grip is made of, so a speed is never measured across a change of it.
 */
export function gripOf(wrists: BodySample['wrists'], hand: Hand): { point: Point; source: Hand } | null {
  if (hand !== 'both') {
    const wrist = wrists[hand]
    return wrist && { point: wrist, source: hand }
  }
  if (wrists.left && wrists.right) return { point: meanPoint([wrists.left, wrists.right]), source: 'both' }
  if (wrists.left) return { point: wrists.left, source: 'left' }
  return wrists.right && { point: wrists.right, source: 'right' }
}

/** How far the shoulders' midline moved sideways, or 0 unless both shoulders were seen both times. */
export function midlineShift(from: BodySample['shoulders'], to: BodySample['shoulders']) {
  return from && to ? Math.abs(to.midX - from.midX) : 0
}
