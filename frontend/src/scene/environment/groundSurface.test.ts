import { describe, expect, it } from 'vitest'
import { getGroundSurface } from './groundSurface'
import type { TownRoad } from '../objects/roads/roadLayout'

const road: TownRoad = {
  id: 'lane',
  color: '#d7c79f',
  width: 4,
  points: [
    [0, 0],
    [10, 0],
    [10, 10],
  ],
}
const plaza = { x: -20, z: 0, radius: 9 }
const step = (x: number, z: number, snow = 0) => ({ x, z, running: false, snow })

describe('footstep ground surface', () => {
  it('treats a step within half a road width of any segment as path, but not past its end', () => {
    expect(getGroundSurface(step(5, 1.9), [road], null)).toBe('path')
    expect(getGroundSurface(step(11.9, 6), [road], null)).toBe('path')
    expect(getGroundSurface(step(5, 2.1), [road], null)).toBe('grass')
    expect(getGroundSurface(step(10, 14), [road], null)).toBe('grass')
  })

  it('treats the fountain plaza as path', () => {
    expect(getGroundSurface(step(-12.5, 0), [], plaza)).toBe('path')
    expect(getGroundSurface(step(-10.5, 0), [], plaza)).toBe('grass')
  })

  it('crunches in snow from half cover, even on a road', () => {
    expect(getGroundSurface(step(5, 0, 0.49), [road], plaza)).toBe('path')
    expect(getGroundSurface(step(5, 0, 0.5), [road], plaza)).toBe('snow')
    expect(getGroundSurface(step(40, 40, 0.5), [road], plaza)).toBe('snow')
  })
})
