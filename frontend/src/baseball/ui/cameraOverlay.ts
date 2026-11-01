import {
  type Box,
  isVisible,
  KEYPOINT_VISIBILITY,
  type Keypoint,
  type KeypointName,
  type Keypoints,
  type Point,
} from '../vision/poseLandmarks'

// The camera panel's picture, drawn on its canvas by the vision loop for every camera frame, never through React: the
// frame mirrored, as a visitor expects to see themselves, with the upper body the pose task found on it and the box of
// the object it locked. The panel's words are its DOM (CameraPanel.tsx), so nothing drawn here is ever read backwards.

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
 * Draws `video`'s current frame mirrored on `canvas`, with `keypoints` and the locked object's `heldBox` (both in the
 * raw, unmirrored image; the box in image units) over it.
 */
export function drawCameraView(
  canvas: HTMLCanvasElement,
  video: HTMLVideoElement,
  keypoints: Keypoints | null,
  heldBox: Box | null,
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
  if (heldBox) drawHeldBox(context, heldBox, width, height)
  context.restore()
}

/** The locked object's box, `box` in image units (x scaled by the aspect), on a `width` by `height` canvas. */
export function drawHeldBox(context: CanvasRenderingContext2D, box: Box, width: number, height: number) {
  const unit = width / OVERLAY_STYLE.referenceWidth
  // An image unit is the picture's height in pixels, across as well as down.
  const pixels = height
  context.beginPath()
  context.roundRect(box.x * pixels, box.y * pixels, box.width * pixels, box.height * pixels, 6 * unit)
  context.strokeStyle = OVERLAY_STYLE.outline
  context.lineWidth = 6 * unit
  context.stroke()
  context.strokeStyle = OVERLAY_STYLE.heldObject
  context.lineWidth = 3 * unit
  context.stroke()
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
