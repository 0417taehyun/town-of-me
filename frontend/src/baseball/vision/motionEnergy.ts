import type { Box } from './poseLandmarks'

// How much the camera picture changes where a swing goes (swingTracker.ts's band): a swing blurs and changes a lot of
// pixels there, while pose jitter changes none, so a sweep the pose says is a swing must also light the band up. Each
// frame is shrunk to a small gray picture on this device and compared with the one before; nothing is kept beyond the
// previous picture, which is wiped when the camera turns off, and nothing leaves the page.

/** The size of the gray picture compared, and the change (0-255) that counts a pixel as clearly moving. */
export const MOTION_ENERGY = { width: 160, height: 120, movingPixel: 24 }

/** The mean gray change per pixel in the band (0-255), and the share of its pixels clearly moving (0..1). */
export type Energy = { value: number; moving: number }

export const NO_ENERGY: Energy = { value: 0, moving: 0 }

/**
 * `measure` takes each new frame of a video and returns the motion in `band` (a part of the raw, unmirrored picture,
 * as shares of it) since the last; a null band measures nothing but keeps the frame. `clear` wipes the frame kept.
 */
export type MotionEnergySampler = {
  measure: (video: CanvasImageSource, band: Box | null) => Energy
  clear: () => void
}

/** The motion in `band` between two gray pictures `width` pixels wide. */
export function bandEnergy(previous: Uint8ClampedArray, current: Uint8ClampedArray, width: number, band: Box) {
  const height = current.length / width
  const left = Math.max(0, Math.floor(band.x * width))
  const right = Math.min(width, Math.ceil((band.x + band.width) * width))
  const top = Math.max(0, Math.floor(band.y * height))
  const bottom = Math.min(height, Math.ceil((band.y + band.height) * height))
  const count = Math.max(0, right - left) * Math.max(0, bottom - top)
  if (count === 0) return NO_ENERGY
  let total = 0
  let moving = 0
  for (let row = top; row < bottom; row++) {
    const change = rowChange(previous, current, row * width + left, row * width + right)
    total += change.total
    moving += change.moving
  }
  return { value: total / count, moving: moving / count }
}

/** The summed gray change, and the number of clearly moving pixels, from index `start` up to `end`. */
export function rowChange(previous: Uint8ClampedArray, current: Uint8ClampedArray, start: number, end: number) {
  let total = 0
  let moving = 0
  for (let index = start; index < end; index++) {
    const change = Math.abs(current[index] - previous[index])
    total += change
    moving += Number(change > MOTION_ENERGY.movingPixel)
  }
  return { total, moving }
}

/** The gray of each RGBA pixel in `pixels`, written into `gray`. */
export function toGray(pixels: Uint8ClampedArray, gray: Uint8ClampedArray) {
  for (let index = 0; index < gray.length; index++) {
    const start = index * 4
    gray[index] = (pixels[start] * 77 + pixels[start + 1] * 150 + pixels[start + 2] * 29) >> 8
  }
  return gray
}

/**
 * A sampler that shrinks each frame onto a small canvas of its own; without a 2D context it measures no motion. Each
 * camera gets its own, cleared when that camera turns off.
 */
export function createMotionEnergy(): MotionEnergySampler {
  const { width, height } = MOTION_ENERGY
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const context = canvas.getContext('2d', { willReadFrequently: true })
  let previous: Uint8ClampedArray | null = null
  const measure = (video: CanvasImageSource, band: Box | null) => {
    if (!context) return NO_ENERGY
    context.drawImage(video, 0, 0, width, height)
    const gray = toGray(context.getImageData(0, 0, width, height).data, new Uint8ClampedArray(width * height))
    const last = previous
    previous = gray
    return last && band ? bandEnergy(last, gray, width, band) : NO_ENERGY
  }
  const clear = () => {
    canvas.width = 0
    previous = null
  }
  return { measure, clear }
}
