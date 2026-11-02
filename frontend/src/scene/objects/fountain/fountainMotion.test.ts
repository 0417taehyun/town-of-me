import { describe, expect, it } from 'vitest'
import { Object3D } from 'three'
import { getFountainFlow, setFountainDrop } from './fountainMotion'

describe('lightweight fountain water', () => {
  it('runs the jet until the snow cover passes about half and stops it under deep snow', () => {
    expect(getFountainFlow(0.3)).toBe(1)
    expect(getFountainFlow(0.5)).toBeCloseTo(0.5)
    expect(getFountainFlow(0.7)).toBe(0)
    const transform = new Object3D()
    setFountainDrop(transform, 5, 3, getFountainFlow(0.9))
    expect(transform.scale.y).toBe(0)
  })
})
