import type { PoseLandmarkerResult } from '@mediapipe/tasks-vision'
import { describe, expect, it, vi } from 'vitest'
import { type CameraStatus, type CameraTrackingParts, trackCamera } from './cameraTracking'
import type { VisionTask } from './vision/tasksVision'

const video = {} as HTMLVideoElement

/** Tracks the camera with `parts` and returns the statuses it reported. */
async function statusesOf(parts: CameraTrackingParts) {
  const statuses: CameraStatus[] = []
  await trackCamera(
    video,
    new AbortController().signal,
    { onStatus: (status) => statuses.push(status), onFrame: () => undefined },
    parts,
  )
  return statuses
}

describe('camera tracking', () => {
  it('names a refused camera as its cause and frees the pose task that loaded meanwhile', async () => {
    const tracker: VisionTask<PoseLandmarkerResult> = { detect: () => null, close: vi.fn() }
    const statuses = await statusesOf({
      start: async () => {
        throw new DOMException('Permission denied', 'NotAllowedError')
      },
      createTracker: async () => tracker,
    })
    expect(statuses).toEqual([{ kind: 'problem', problem: 'denied' }])
    await vi.waitFor(() => expect(tracker.close).toHaveBeenCalled())
  })

  it('blames tracking, not the camera, when the pose task cannot start on a camera that works', async () => {
    const statuses = await statusesOf({
      start: async () => ({ noteMovement: () => undefined }),
      createTracker: async () => {
        throw new Error('Failed to fetch the model')
      },
    })
    expect(statuses).toEqual([{ kind: 'loading' }, { kind: 'problem', problem: 'tracking' }])
  })
})
