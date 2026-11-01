import { describe, expect, it } from 'vitest'
import type { Keypoints } from '../vision/poseLandmarks'
import { bonesInView, tappedImagePoint, wristsInView } from './cameraOverlay'

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

  it('finds a tap on the mirrored picture in the raw image, also where the picture is cropped to fill the panel', () => {
    const panel = { left: 100, top: 50, width: 400, height: 300 }
    const fourByThree = { width: 640, height: 480 }
    // The visitor's right hand shows on the panel's right, and is on the raw image's left.
    const right = tappedImagePoint({ x: 450, y: 125 }, panel, fourByThree)
    expect(right?.x).toBeCloseTo((1 - 0.875) * (4 / 3), 9)
    expect(right?.y).toBeCloseTo(0.25, 9)
    // A 16:9 picture fills the 4:3 panel by height, its sides cut off: the panel's centre is still the image's.
    const wide = { width: 1280, height: 720 }
    expect(tappedImagePoint({ x: 300, y: 200 }, panel, wide)?.x).toBeCloseTo(0.5 * (16 / 9), 9)
    expect(tappedImagePoint({ x: 100, y: 200 }, panel, wide)?.x).toBeCloseTo((1 - 1 / 8) * (16 / 9), 9)
    expect(tappedImagePoint({ x: 300, y: 200 }, panel, { width: 0, height: 0 })).toBeNull()
  })
})
