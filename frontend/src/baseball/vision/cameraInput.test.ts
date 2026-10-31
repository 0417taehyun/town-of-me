import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { CAMERA_IDLE_LIMIT_MS, type CameraEnvironment, startCamera } from './cameraInput'

/** A webcam with a video track and a second track, on a page and a clock the test drives. */
function fakeCamera() {
  const tracks = [
    Object.assign(new EventTarget(), { stop: vi.fn() }),
    Object.assign(new EventTarget(), { stop: vi.fn() }),
  ]
  const stream = { getTracks: () => tracks } as unknown as MediaStream
  const getUserMedia = vi.fn(async (constraints?: MediaStreamConstraints) => {
    void constraints
    return stream
  })
  const page = new EventTarget()
  const environment: CameraEnvironment = {
    mediaDevices: { getUserMedia },
    page,
    clock: {
      now: () => Date.now(),
      setTimeout: (callback, delay) => setTimeout(callback, delay),
      clearTimeout: (handle) => clearTimeout(handle),
    },
  }
  const video = { srcObject: null as MediaProvider | null, play: vi.fn(async () => undefined) }
  const onStopped = vi.fn()
  const allStopped = () => tracks.every((track) => track.stop.mock.calls.length > 0)
  const anyStopped = () => tracks.some((track) => track.stop.mock.calls.length > 0)
  const start = (signal = new AbortController().signal) => startCamera(video, { signal, environment, onStopped })
  return { stream, tracks, getUserMedia, page, video, onStopped, allStopped, anyStopped, start }
}

describe('the camera input', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('asks for video only and stops every track after two minutes without movement', async () => {
    const camera = fakeCamera()
    await camera.start()
    expect(camera.getUserMedia.mock.calls[0][0]?.audio).toBe(false)
    expect(camera.video.srcObject).toBe(camera.stream)

    vi.advanceTimersByTime(CAMERA_IDLE_LIMIT_MS - 1)
    expect(camera.anyStopped()).toBe(false)
    vi.advanceTimersByTime(1)
    expect(camera.allStopped()).toBe(true)
    expect(camera.video.srcObject).toBeNull()
    expect(camera.onStopped).toHaveBeenCalledExactlyOnceWith('idle')
  })

  it('keeps the camera on for two minutes after the last movement', async () => {
    const camera = fakeCamera()
    const input = await camera.start()
    vi.advanceTimersByTime(CAMERA_IDLE_LIMIT_MS - 10_000)
    input.noteMovement()
    vi.advanceTimersByTime(CAMERA_IDLE_LIMIT_MS - 1)
    expect(camera.anyStopped()).toBe(false)
    vi.advanceTimersByTime(1)
    expect(camera.allStopped()).toBe(true)
  })

  it('stops every track when the visitor leaves the page, or when the signal aborts', async () => {
    const leaving = fakeCamera()
    await leaving.start()
    leaving.page.dispatchEvent(new Event('pagehide'))
    expect(leaving.allStopped()).toBe(true)
    expect(leaving.onStopped).toHaveBeenCalledExactlyOnceWith('pagehide')

    const unmounting = fakeCamera()
    const controller = new AbortController()
    await unmounting.start(controller.signal)
    controller.abort()
    expect(unmounting.allStopped()).toBe(true)
    expect(unmounting.onStopped).not.toHaveBeenCalled()
  })

  it('stops every track and says why when the camera ends by itself, as when it is unplugged', async () => {
    const camera = fakeCamera()
    await camera.start()
    camera.tracks[0].dispatchEvent(new Event('ended'))
    expect(camera.allStopped()).toBe(true)
    expect(camera.video.srcObject).toBeNull()
    expect(camera.onStopped).toHaveBeenCalledExactlyOnceWith('ended')
    vi.advanceTimersByTime(CAMERA_IDLE_LIMIT_MS)
    expect(camera.onStopped).toHaveBeenCalledTimes(1)
  })

  it('stops a camera granted after the signal aborted, while the browser was still asking', async () => {
    const camera = fakeCamera()
    let grant = () => {}
    camera.getUserMedia.mockImplementation(() => new Promise((resolve) => (grant = () => resolve(camera.stream))))
    const controller = new AbortController()
    const starting = camera.start(controller.signal)
    controller.abort()
    grant()
    await expect(starting).rejects.toMatchObject({ name: 'AbortError' })
    expect(camera.allStopped()).toBe(true)
    expect(camera.video.srcObject).toBeNull()
  })
})
