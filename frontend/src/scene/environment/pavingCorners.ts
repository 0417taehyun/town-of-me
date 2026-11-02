import { clamp01 } from '../../motionMath'
import type { TownRoad } from '../objects/roads/roadLayout'

// Rounds the inner corners where a code-owned road leaves the town's roads, so the two read as one paved path: a
// morphological closing of the painted ground, the paving grown by the radius and then shrunk back by it. Concave
// corners become arcs tangent to both edges, a grass sliver narrower than twice the radius fills, and straight or
// convex edges stay exactly where they were.

/** Stands for "no source on this line yet": larger than any squared distance on the ground texture. */
const FAR = 1e20

/** The lower envelope of one line's parabolas, as Felzenszwalb and Huttenlocher's distance transform builds it. */
export type LowerEnvelope = { values: Float64Array; parabolas: Int32Array; bounds: Float64Array }

export function createLowerEnvelope(size: number): LowerEnvelope {
  return { values: new Float64Array(size), parabolas: new Int32Array(size), bounds: new Float64Array(size + 1) }
}

/** Where the parabola rooted at `later` drops below the one rooted at `earlier`. */
export function parabolaMeeting(values: Float64Array, later: number, earlier: number) {
  return (values[later] + later * later - (values[earlier] + earlier * earlier)) / (2 * later - 2 * earlier)
}

/** Adds the parabola rooted at `position` after dropping those it hides, and returns the envelope's new last index. */
export function addParabola({ values, parabolas, bounds }: LowerEnvelope, position: number, last: number) {
  let index = last
  let meeting = parabolaMeeting(values, position, parabolas[index])
  while (meeting <= bounds[index]) {
    index -= 1
    meeting = parabolaMeeting(values, position, parabolas[index])
  }
  parabolas[index + 1] = position
  bounds[index + 1] = meeting
  bounds[index + 2] = FAR
  return index + 1
}

/** The envelope's parabola that is lowest at `position`, searching on from `start`. */
export function lowestParabolaAt({ bounds }: LowerEnvelope, start: number, position: number) {
  let index = start
  while (bounds[index + 1] < position) index += 1
  return index
}

/** One pass of the exact Euclidean distance transform over `count` cells of `field`, `stride` apart from `offset`. */
export function transformLine(
  field: Float64Array,
  count: number,
  offset: number,
  stride: number,
  envelope: LowerEnvelope,
) {
  const { values, parabolas, bounds } = envelope
  for (let position = 0; position < count; position += 1) values[position] = field[offset + position * stride]
  parabolas[0] = 0
  bounds[0] = -FAR
  bounds[1] = FAR
  let last = 0
  for (let position = 1; position < count; position += 1) last = addParabola(envelope, position, last)
  let lowest = 0
  for (let position = 0; position < count; position += 1) {
    lowest = lowestParabolaAt(envelope, lowest, position)
    field[offset + position * stride] = (position - parabolas[lowest]) ** 2 + values[parabolas[lowest]]
  }
}

/** Squared distance from every cell of a `width` × `height` grid to the nearest cell where `isSource` is 1. */
export function squaredDistanceField(width: number, height: number, isSource: ArrayLike<number>) {
  const field = Float64Array.from(isSource, (source) => (source ? 0 : FAR))
  const envelope = createLowerEnvelope(Math.max(width, height))
  for (let column = 0; column < width; column += 1) transformLine(field, height, column, width, envelope)
  for (let row = 0; row < height; row += 1) transformLine(field, width, row * width, 1, envelope)
  return field
}

/** Whether a cell lies on the window's outer frame. */
export function isWindowFrame(index: number, width: number, height: number) {
  const column = index % width
  return index < width || index >= width * (height - 1) || column === 0 || column === width - 1
}

/** Paints the cell in `rgb` at `alpha` when that is more opaque than what it shows, so paving only ever grows. */
export function raisePavingAlpha(pixels: Uint8ClampedArray, index: number, alpha: number, rgb: readonly number[]) {
  if (alpha <= pixels[index * 4 + 3]) return
  pixels.set([...rgb, alpha], index * 4)
}

/**
 * Closes the paving in an RGBA window by `radius` pixels, painting what it adds in `rgb`. The window's frame counts as
 * open grass, so paving that runs out of the window grows nothing along its edge and nothing past the window changes.
 */
export function closePaving(
  pixels: Uint8ClampedArray,
  width: number,
  height: number,
  radius: number,
  rgb: readonly number[],
) {
  const cells = width * height
  const paved = Uint8Array.from({ length: cells }, (_, index) => (pixels[index * 4 + 3] >= 128 ? 1 : 0))
  const toPaving = squaredDistanceField(width, height, paved)
  const open = Uint8Array.from(toPaving, (distance, index) =>
    distance > radius * radius || isWindowFrame(index, width, height) ? 1 : 0,
  )
  const toOpen = squaredDistanceField(width, height, open)
  for (let index = 0; index < cells; index += 1) {
    // Half a pixel inside the closed edge, so an edge the closing leaves alone keeps its own anti-aliasing.
    const coverage = clamp01(Math.sqrt(toOpen[index]) - radius - 0.5)
    raisePavingAlpha(pixels, index, Math.round(coverage * 255), rgb)
  }
}

/** The ground around a road that its rounding may change, in metres: its points, its end pad, and room to round. */
export function roundingWindow({ points, width }: TownRoad, radius: number) {
  const margin = width * 0.76 + radius * 3
  const xs = points.map(([x]) => x)
  const zs = points.map(([, z]) => z)
  return {
    minX: Math.min(...xs) - margin,
    minZ: Math.min(...zs) - margin,
    maxX: Math.max(...xs) + margin,
    maxZ: Math.max(...zs) + margin,
  }
}

/** A `#rrggbb` color as its three channels. */
export function hexChannels(color: string) {
  return [1, 3, 5].map((start) => Number.parseInt(color.slice(start, start + 2), 16))
}
