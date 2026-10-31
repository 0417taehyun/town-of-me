// The webcam, which never leaves this device: video only, never audio, shown and tracked in this page and never
// recorded. The page promises that the camera turns off when the visitor leaves it or stops moving for two minutes,
// and this module keeps that promise by stopping every track: on `pagehide` (closing the tab, following a link, or
// going into the back-forward cache), after two minutes without movement, and when the caller's signal aborts (the
// camera's component unmounting), even while the browser is still asking for permission. A camera that ends by itself
// (unplugged, its permission revoked, or taken by another app) is stopped and reported too, so the page never waits on
// frames that will not come.

/** How long the camera stays on without the visitor moving. */
export const CAMERA_IDLE_LIMIT_MS = 2 * 60 * 1000

export const CAMERA_CONSTRAINTS = {
  audio: false,
  video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 }, frameRate: { ideal: 60 } },
} satisfies MediaStreamConstraints

/** Why the camera turned off without the page asking. */
export type CameraStopReason = 'idle' | 'pagehide' | 'ended'

export type CameraClock = {
  now: () => number
  setTimeout: (callback: () => void, delay: number) => ReturnType<typeof setTimeout>
  clearTimeout: (handle: ReturnType<typeof setTimeout> | undefined) => void
}

/** What the camera reads from the browser; tests pass fakes. */
export type CameraEnvironment = {
  mediaDevices: Pick<MediaDevices, 'getUserMedia'> | undefined
  /** Where `pagehide` fires: the window. */
  page: Pick<EventTarget, 'addEventListener' | 'removeEventListener'>
  clock: CameraClock
}

export type CameraVideo = Pick<HTMLVideoElement, 'srcObject' | 'play'>

export type CameraOptions = {
  /** Aborting it turns the camera off; abort it when the camera's component unmounts. */
  signal: AbortSignal
  /** Called once if the camera turns itself off, never after `signal` aborts. */
  onStopped?: (reason: CameraStopReason) => void
  environment?: CameraEnvironment
}

export type CameraInput = {
  /** Tells the camera the visitor moved, which keeps it on for another two minutes. */
  noteMovement: () => void
}

export function browserCameraEnvironment(): CameraEnvironment {
  return {
    mediaDevices: navigator.mediaDevices,
    page: window,
    clock: {
      now: () => performance.now(),
      setTimeout: (callback, delay) => setTimeout(callback, delay),
      clearTimeout: (handle) => clearTimeout(handle),
    },
  }
}

/**
 * Turns the camera on into `video`. Rejects with the browser's error when the camera cannot start (deviceGate.ts
 * names its cause), and with the signal's reason when the signal aborts first; either way no track is left running.
 */
export async function startCamera(
  video: CameraVideo,
  { signal, onStopped, environment = browserCameraEnvironment() }: CameraOptions,
): Promise<CameraInput> {
  const { mediaDevices, page, clock } = environment
  signal.throwIfAborted()
  // Missing outside a secure context (https or localhost).
  if (!mediaDevices) throw new DOMException('This page cannot use a camera.', 'NotSupportedError')
  const stream = await mediaDevices.getUserMedia(CAMERA_CONSTRAINTS)
  let lastMovementAt = clock.now()
  let idleTimer: ReturnType<typeof setTimeout> | undefined
  let stopped = false

  const stop = (reason: CameraStopReason | null) => {
    if (stopped) return
    stopped = true
    stream.getTracks().forEach((track) => {
      track.removeEventListener('ended', onEnded)
      track.stop()
    })
    video.srcObject = null
    clock.clearTimeout(idleTimer)
    page.removeEventListener('pagehide', onPageHide)
    signal.removeEventListener('abort', onAbort)
    if (reason) onStopped?.(reason)
  }
  const onPageHide = () => stop('pagehide')
  const onEnded = () => stop('ended')
  const onAbort = () => stop(null)
  // Waits out the rest of the two minutes since the last movement, then turns the camera off if nothing moved since.
  const checkIdle = () => {
    const idleFor = clock.now() - lastMovementAt
    if (idleFor >= CAMERA_IDLE_LIMIT_MS) return stop('idle')
    idleTimer = clock.setTimeout(checkIdle, CAMERA_IDLE_LIMIT_MS - idleFor)
  }

  if (signal.aborted) {
    stop(null)
    throw signal.reason
  }
  page.addEventListener('pagehide', onPageHide)
  stream.getTracks().forEach((track) => track.addEventListener('ended', onEnded))
  signal.addEventListener('abort', onAbort, { once: true })
  idleTimer = clock.setTimeout(checkIdle, CAMERA_IDLE_LIMIT_MS)
  try {
    video.srcObject = stream
    await video.play()
  } catch (error) {
    stop(null)
    throw error
  }
  return {
    noteMovement: () => {
      lastMovementAt = clock.now()
    },
  }
}
