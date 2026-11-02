import { describe, expect, it } from 'vitest'
import { closePaving, squaredDistanceField } from './pavingCorners'

function bruteForceDistances(width: number, height: number, sources: number[]) {
  const sourceCells = sources.flatMap((source, index) => (source ? [index] : []))
  return Array.from({ length: width * height }, (_, index) =>
    Math.min(
      ...sourceCells.map(
        (cell) => ((cell % width) - (index % width)) ** 2 + (Math.floor(cell / width) - Math.floor(index / width)) ** 2,
      ),
    ),
  )
}

const size = 60
const roadColor = [1, 2, 3]
const fillColor = [9, 9, 9]

/** A road down columns 10–19 and a branch along rows 30–54 out to column 49, leaving five rows of grass below it. */
function pavedWindow() {
  const pixels = new Uint8ClampedArray(size * size * 4)
  const paved = (x: number, y: number) => (x >= 10 && x < 20) || (x >= 20 && x < 50 && y >= 30 && y < 55)
  Array.from({ length: size * size }, (_, index) => index)
    .filter((index) => paved(index % size, Math.floor(index / size)))
    .forEach((index) => pixels.set([...roadColor, 255], index * 4))
  return pixels
}

const pixelAt = (pixels: Uint8ClampedArray, x: number, y: number) =>
  Array.from(pixels.subarray((y * size + x) * 4, (y * size + x) * 4 + 4))

describe('rounding the corners where a branch leaves a road', () => {
  it('measures the exact squared distance to the nearest source, across empty rows and columns too', () => {
    const width = 23
    const height = 17
    const sourceCells = new Set([5, 40, 41, 200, 333, 384])
    const sources = Array.from({ length: width * height }, (_, index) => (sourceCells.has(index) ? 1 : 0))
    expect(Array.from(squaredDistanceField(width, height, sources))).toEqual(
      bruteForceDistances(width, height, sources),
    )
  })

  it('fills the inside corner in the branch color and leaves edges, outside corners, and the window frame alone', () => {
    const pixels = pavedWindow()
    closePaving(pixels, size, size, 8, fillColor)
    expect(pixelAt(pixels, 21, 29)).toEqual([...fillColor, 255])
    expect(pixelAt(pixels, 15, 15)).toEqual([...roadColor, 255])
    // A straight edge, the branch's outside corner, and the strip of grass between the branch and the window's edge.
    expect(pixelAt(pixels, 20, 10)[3]).toBe(0)
    expect(pixelAt(pixels, 51, 29)[3]).toBe(0)
    expect(pixelAt(pixels, 30, 57)[3]).toBe(0)
  })
})
