import type { NormalizedLandmark } from '@mediapipe/tasks-vision'
import { describe, expect, it } from 'vitest'
import { bodyMoved, bodySample, POSE_KEYPOINT_INDEX, poseKeypoints } from './poseLandmarks'

/** A 33-landmark pose with the named landmarks placed and everything else out of sight. */
function pose(placed: Partial<Record<keyof typeof POSE_KEYPOINT_INDEX, [number, number, number]>>) {
  const landmarks: NormalizedLandmark[] = Array.from({ length: 33 }, () => ({ x: 0, y: 0, z: 0, visibility: 0 }))
  for (const [name, [x, y, visibility]] of Object.entries(placed)) {
    landmarks[POSE_KEYPOINT_INDEX[name as keyof typeof POSE_KEYPOINT_INDEX]] = { x, y, z: 0, visibility }
  }
  return poseKeypoints(landmarks)
}

describe('pose landmarks', () => {
  it('names wrists for the person, scales x by the aspect, and drops what is barely visible', () => {
    const body = bodySample(
      pose({
        leftShoulder: [0.6, 0.4, 0.9],
        rightShoulder: [0.4, 0.4, 0.9],
        leftWrist: [0.7, 0.6, 0.8],
        rightWrist: [0.3, 0.6, 0.2],
      }),
      4 / 3,
    )
    expect(body?.wrists.left?.x).toBeCloseTo(0.7 * (4 / 3), 9)
    expect(body?.wrists.right).toBeNull()
    expect(body?.shoulders?.width).toBeCloseTo(0.2 * (4 / 3), 9)
    expect(body?.shoulders?.midX).toBeCloseTo(0.5 * (4 / 3), 9)
  })

  it('keeps a wrist without shoulders, and finds no body when neither shows', () => {
    const wristOnly = bodySample(pose({ rightWrist: [0.3, 0.5, 0.9], leftShoulder: [0.6, 0.4, 0.9] }), 1)
    expect(wristOnly?.shoulders).toBeNull()
    expect(wristOnly?.wrists.right).toEqual({ x: 0.3, y: 0.5 })
    expect(bodySample(pose({ leftShoulder: [0.6, 0.4, 0.9], rightWrist: [0.3, 0.5, 0.1] }), 1)).toBeNull()
  })

  it('counts a step or a swing as movement, but not tracking jitter, a flickering joint, or walking away', () => {
    const standing = bodySample(
      pose({ leftShoulder: [0.6, 0.4, 0.9], rightShoulder: [0.4, 0.4, 0.9], rightWrist: [0.3, 0.6, 0.9] }),
      1,
    )
    const jittered = bodySample(
      pose({ leftShoulder: [0.61, 0.4, 0.9], rightShoulder: [0.41, 0.4, 0.9], rightWrist: [0.31, 0.61, 0.9] }),
      1,
    )
    const swung = bodySample(
      pose({ leftShoulder: [0.6, 0.4, 0.9], rightShoulder: [0.4, 0.4, 0.9], rightWrist: [0.5, 0.45, 0.9] }),
      1,
    )
    const stepped = bodySample(pose({ leftShoulder: [0.75, 0.4, 0.9], rightShoulder: [0.55, 0.4, 0.9] }), 1)
    const flickered = bodySample(
      pose({ leftShoulder: [0.6, 0.4, 0.9], rightShoulder: [0.4, 0.4, 0.9], leftWrist: [0.9, 0.9, 0.9] }),
      1,
    )
    expect(bodyMoved(standing, jittered)).toBe(false)
    expect(bodyMoved(standing, swung)).toBe(true)
    expect(bodyMoved(standing, stepped)).toBe(true)
    expect(bodyMoved(standing, flickered)).toBe(false)
    expect(bodyMoved(null, standing)).toBe(true)
    expect(bodyMoved(standing, null)).toBe(false)
  })
})
