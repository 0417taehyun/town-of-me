import type { HeldObjectLabel } from '../vision/heldObject'
import {
  type Box,
  isVisible,
  KEYPOINT_VISIBILITY,
  type Keypoint,
  type KeypointName,
  type Keypoints,
  type Point,
} from '../vision/poseLandmarks'
import type { ObjectMark } from '../vision/swingTracker'

// The camera panel's picture, drawn on its canvas by the vision loop for every camera frame, never through React: the
// frame mirrored, as a visitor expects to see themselves, with the upper body the pose task found on it and the object
// the swing tracker marks: the box of what the detector found by the hands, dashed, with its name and a bar that fills
// as the lock comes, or solid once locked. The marks are placed mirrored like the picture but drawn unmirrored, so the
// name reads the right way round; the panel's other words are its DOM (CameraPanel.tsx).

/** The upper body's bones, shoulder to shoulder and down each arm. */
export const UPPER_BODY_BONES: readonly (readonly [KeypointName, KeypointName])[] = [
  ['leftShoulder', 'rightShoulder'],
  ['leftShoulder', 'leftElbow'],
  ['leftElbow', 'leftWrist'],
  ['rightShoulder', 'rightElbow'],
  ['rightElbow', 'rightWrist'],
]

export const OVERLAY_STYLE = {
  /** Darkens the frame a little so the bones stand out on a bright room. */
  shade: 'rgba(20, 32, 28, 0.18)',
  bone: '#fffef9',
  outline: 'rgba(31, 42, 38, 0.7)',
  wrist: '#f2b544',
  heldObject: '#ef7d57',
  /** A box found but not locked yet, and the name on its chip's dark ground. */
  candidate: '#fffef9',
  chip: 'rgba(31, 42, 38, 0.82)',
  chipFontSize: 13,
  /** How much of the picture's top the panel's caption covers (in the side panel; less on the stage). */
  captionBand: 0.18,
  /** The canvas width that draws lines at their nominal width; a wider frame draws them wider. */
  referenceWidth: 320,
}

/** The bones whose ends the pose task sees as well as a swing needs a wrist: a bone to a guessed joint points anywhere. */
export function bonesInView(keypoints: Keypoints): [Keypoint, Keypoint][] {
  return UPPER_BODY_BONES.map(([from, to]) => [keypoints[from], keypoints[to]]).filter(
    (ends): ends is [Keypoint, Keypoint] => ends.every((end) => isVisible(end, KEYPOINT_VISIBILITY.wrist)),
  )
}

export function wristsInView(keypoints: Keypoints): Keypoint[] {
  return [keypoints.leftWrist, keypoints.rightWrist].filter((wrist) => isVisible(wrist, KEYPOINT_VISIBILITY.wrist))
}

/** Gives the canvas the video's own size, so both crop alike under the panel's `object-fit`; resizing wipes it. */
export function fitCanvas(canvas: HTMLCanvasElement, width: number, height: number) {
  if (canvas.width === width && canvas.height === height) return
  canvas.width = width
  canvas.height = height
}

/** Wipes the picture when the camera turns off, so the next camera never shows the last person's image. */
export function clearCameraView(canvas: HTMLCanvasElement) {
  canvas.width = 0
}

/**
 * Draws `video`'s current frame mirrored on `canvas`, with `keypoints` (in the raw, unmirrored image) and the object
 * `mark` (in its image units) over it, the mark named by `names`.
 */
export function drawCameraView(
  canvas: HTMLCanvasElement,
  video: HTMLVideoElement,
  keypoints: Keypoints | null,
  mark: ObjectMark | null,
  names: Record<HeldObjectLabel, string>,
) {
  const context = canvas.getContext('2d')
  if (!context || !video.videoWidth) return
  fitCanvas(canvas, video.videoWidth, video.videoHeight)
  const { width, height } = canvas
  context.save()
  context.setTransform(-1, 0, 0, 1, width, 0)
  context.drawImage(video, 0, 0, width, height)
  context.fillStyle = OVERLAY_STYLE.shade
  context.fillRect(0, 0, width, height)
  if (keypoints) drawUpperBody(context, keypoints, width, height)
  context.restore()
  if (mark) drawObjectMark(context, mark, mark.label && names[mark.label], width, height)
}

/**
 * Where `box` (raw image units, x scaled by the aspect) shows on a `width` by `height` canvas of the mirrored
 * picture, in canvas pixels: an image unit is the picture's height in pixels, across as well as down.
 */
export function shownBox(box: Box, width: number, height: number): Box {
  return {
    x: width - (box.x + box.width) * height,
    y: box.y * height,
    width: box.width * height,
    height: box.height * height,
  }
}

/**
 * The object `mark` on a `width` by `height` canvas, drawn unmirrored at its mirrored place: its box, solid once
 * locked and dashed before, and over it a chip with its `name` that fills as the lock comes.
 */
export function drawObjectMark(
  context: CanvasRenderingContext2D,
  mark: ObjectMark,
  name: string | null,
  width: number,
  height: number,
) {
  const unit = width / OVERLAY_STYLE.referenceWidth
  const shown = shownBox(mark.box, width, height)
  context.beginPath()
  context.roundRect(shown.x, shown.y, shown.width, shown.height, 6 * unit)
  context.setLineDash(mark.locked ? [] : [7 * unit, 5 * unit])
  context.strokeStyle = OVERLAY_STYLE.outline
  context.lineWidth = 6 * unit
  context.stroke()
  context.strokeStyle = mark.locked ? OVERLAY_STYLE.heldObject : OVERLAY_STYLE.candidate
  context.lineWidth = 3 * unit
  context.stroke()
  context.setLineDash([])
  if (name) drawNameChip(context, name, mark.progress, shown, unit, width, height)
}

/**
 * A chip with `name` by the `shown` box (chipPlace), filled `progress` (0..1) across, in the page's font for its
 * language, which the canvas inherits.
 */
export function drawNameChip(
  context: CanvasRenderingContext2D,
  name: string,
  progress: number,
  shown: Box,
  unit: number,
  width: number,
  height: number,
) {
  context.font = `800 ${OVERLAY_STYLE.chipFontSize * unit}px ${getComputedStyle(context.canvas).fontFamily}`
  const chip = chipPlace(shown, context.measureText(name).width, unit, width, height)
  context.save()
  context.beginPath()
  context.roundRect(chip.x, chip.y, chip.width, chip.height, chip.height / 2)
  context.clip()
  context.fillStyle = OVERLAY_STYLE.chip
  context.fillRect(chip.x, chip.y, chip.width, chip.height)
  context.fillStyle = OVERLAY_STYLE.heldObject
  context.fillRect(chip.x, chip.y, chip.width * progress, chip.height)
  context.restore()
  const centreX = chip.x + chip.width / 2
  const centreY = chip.y + chip.height / 2 + unit
  context.textAlign = 'center'
  context.textBaseline = 'middle'
  context.lineJoin = 'round'
  context.lineWidth = 3 * unit
  context.strokeStyle = OVERLAY_STYLE.outline
  context.strokeText(name, centreX, centreY)
  context.fillStyle = OVERLAY_STYLE.candidate
  context.fillText(name, centreX, centreY)
}

/**
 * The name chip for a name `textWidth` px wide (at `unit` px a reference pixel) by the `shown` box on a `width` by
 * `height` canvas: at its top edge's left, raised above it, but never into the caption's band at the top (lower, inside
 * or under the box, instead), and kept within the canvas. A short name still gets a chip wide enough for its progress
 * to read.
 */
export function chipPlace(shown: Box, textWidth: number, unit: number, width: number, height: number): Box {
  const chipWidth = Math.max(textWidth + 16 * unit, 48 * unit)
  const chipHeight = 22 * unit
  const x = Math.min(Math.max(shown.x, 0), Math.max(width - chipWidth, 0))
  const y = Math.max(shown.y - chipHeight - 3 * unit, OVERLAY_STYLE.captionBand * height)
  return { x, y, width: chipWidth, height: chipHeight }
}

/**
 * Where in the raw, unmirrored image (image units, x scaled by its aspect) a tap at `tap` (client px) on a panel at
 * `bounds` lands, the panel showing an `image` mirrored and cropped to cover it; null before the image has a size.
 */
export function tappedImagePoint(
  tap: Point,
  bounds: Pick<DOMRect, 'left' | 'top' | 'width' | 'height'>,
  image: { width: number; height: number },
): Point | null {
  if (!image.width || !image.height) return null
  const scale = Math.max(bounds.width / image.width, bounds.height / image.height)
  const shownLeft = bounds.left + (bounds.width - image.width * scale) / 2
  const shownTop = bounds.top + (bounds.height - image.height * scale) / 2
  const mirroredX = (tap.x - shownLeft) / (image.width * scale)
  const aspect = image.width / image.height
  return { x: (1 - mirroredX) * aspect, y: (tap.y - shownTop) / (image.height * scale) }
}

export function drawUpperBody(context: CanvasRenderingContext2D, keypoints: Keypoints, width: number, height: number) {
  const unit = width / OVERLAY_STYLE.referenceWidth
  context.lineCap = 'round'
  context.beginPath()
  bonesInView(keypoints).forEach(([from, to]) => {
    context.moveTo(from.x * width, from.y * height)
    context.lineTo(to.x * width, to.y * height)
  })
  context.strokeStyle = OVERLAY_STYLE.outline
  context.lineWidth = 7 * unit
  context.stroke()
  context.strokeStyle = OVERLAY_STYLE.bone
  context.lineWidth = 4 * unit
  context.stroke()
  context.beginPath()
  wristsInView(keypoints).forEach((wrist) => {
    context.moveTo(wrist.x * width + 7 * unit, wrist.y * height)
    context.arc(wrist.x * width, wrist.y * height, 7 * unit, 0, Math.PI * 2)
  })
  context.fillStyle = OVERLAY_STYLE.wrist
  context.fill()
  context.strokeStyle = OVERLAY_STYLE.outline
  context.lineWidth = 2 * unit
  context.stroke()
}
