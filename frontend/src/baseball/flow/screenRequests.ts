// What the camera game asks of the browser besides the camera and the sound: the full screen, from the one click that
// starts the camera, so the play reads from where the visitor stands, and a screen that stays on while the camera is
// on, since nobody touches the computer while they play. Neither is needed to play, so a browser that refuses either
// changes nothing. A browser ends a wake lock whenever the page is hidden, so it is asked for again each time the page
// shows.

/** The page and the wake lock API as keepScreenOn reads them; tests pass fakes. */
export type WakeLockHost = {
  wakeLock: Pick<WakeLock, 'request'> | undefined
  page: Pick<Document, 'visibilityState' | 'addEventListener' | 'removeEventListener'>
}

/** Asks for the full screen; call it from the click itself, which the browser requires. */
export function requestFullscreen(page: Pick<Document, 'documentElement' | 'fullscreenElement'> = document) {
  if (page.fullscreenElement || !page.documentElement.requestFullscreen) return
  page.documentElement.requestFullscreen().catch(() => undefined)
}

/** Keeps the screen on while the page shows, until the returned function lets it sleep again. */
export function keepScreenOn({ wakeLock, page }: WakeLockHost = { wakeLock: navigator.wakeLock, page: document }) {
  let lock: WakeLockSentinel | null = null
  let stopped = false
  const release = () => lock?.release().catch(() => undefined)
  // A lock granted after the screen may sleep again is let go at once.
  const keep = (sentinel: WakeLockSentinel) => {
    lock = sentinel
    if (stopped) release()
  }
  const request = () => {
    if (stopped || !wakeLock || page.visibilityState !== 'visible') return
    wakeLock.request('screen').then(keep, () => undefined)
  }
  page.addEventListener('visibilitychange', request)
  request()
  return () => {
    stopped = true
    page.removeEventListener('visibilitychange', request)
    release()
  }
}
