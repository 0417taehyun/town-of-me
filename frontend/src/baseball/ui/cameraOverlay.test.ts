import { describe, expect, it } from 'vitest'
import type { Keypoints } from '../vision/poseLandmarks'
import { bonesInView, wristsInView } from './cameraOverlay'

const seen = (x: number, y: number) => ({ x, y, score: 0.9 })

describe('the camera overlay', () => {
  it('draws only the bones and wrists the pose task sees, never a line to a guessed joint', () => {
    const keypoints: Keypoints = {
      nose: seen(0.5, 0.2),
      leftShoulder: seen(0.6, 0.4),
      rightShoulder: seen(0.4, 0.4),
      leftElbow: seen(0.65, 0.55),
      rightElbow: { x: 0.9, y: 0.95, score: 0.1 },
      leftWrist: seen(0.7, 0.7),
      rightWrist: null,
    }
    expect(bonesInView(keypoints)).toEqual([
      [seen(0.6, 0.4), seen(0.4, 0.4)],
      [seen(0.6, 0.4), seen(0.65, 0.55)],
      [seen(0.65, 0.55), seen(0.7, 0.7)],
    ])
    expect(wristsInView(keypoints)).toEqual([seen(0.7, 0.7)])
  })
})
