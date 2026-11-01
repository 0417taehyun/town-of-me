import { describe, expect, it } from 'vitest'
import { bandEnergy, MOTION_ENERGY } from './motionEnergy'

const WIDTH = 8
const HEIGHT = 8

/** A gray picture WIDTH by HEIGHT, `changed` at the pixels (column, row) given, unchanged elsewhere. */
function picture(changed: readonly [number, number][] = [], by = 0) {
  const gray = new Uint8ClampedArray(WIDTH * HEIGHT).fill(100)
  changed.forEach(([column, row]) => (gray[row * WIDTH + column] = 100 + by))
  return gray
}

describe('motion energy', () => {
  it('counts only the change inside the band, and only clear changes as moving', () => {
    const before = picture()
    // The band is columns 2-5 and rows 4-7: 16 pixels.
    const band = { x: 0.25, y: 0.5, width: 0.5, height: 0.5 }
    const inside = picture([[3, 5]], 80)
    expect(bandEnergy(before, inside, WIDTH, band)).toEqual({ value: 80 / 16, moving: 1 / 16 })
    expect(bandEnergy(before, picture([[7, 5]], 80), WIDTH, band)).toEqual({ value: 0, moving: 0 })
    const faint = picture([[3, 5]], MOTION_ENERGY.movingPixel)
    expect(bandEnergy(before, faint, WIDTH, band).moving).toBe(0)
  })
})
