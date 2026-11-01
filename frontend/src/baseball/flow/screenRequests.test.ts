import { describe, expect, it } from 'vitest'
import { keepScreenOn, type WakeLockHost } from './screenRequests'

/** A page that can be hidden and shown, and a wake lock that grants (or refuses) each request after a tick. */
function fakeHost(grants = true) {
  const page = Object.assign(new EventTarget(), { visibilityState: 'visible' as DocumentVisibilityState })
  const locks: { released: boolean }[] = []
  const wakeLock = {
    request: () => {
      if (!grants) return Promise.reject(new DOMException('refused', 'NotAllowedError'))
      const lock = { released: false, release: async () => void (lock.released = true) }
      locks.push(lock)
      return Promise.resolve(lock as unknown as WakeLockSentinel)
    },
  }
  const show = (visibility: DocumentVisibilityState) => {
    page.visibilityState = visibility
    page.dispatchEvent(new Event('visibilitychange'))
  }
  return { host: { wakeLock, page } as WakeLockHost, locks, show }
}

const tick = () => new Promise((resolve) => setTimeout(resolve, 0))

describe('keeping the screen on', () => {
  it('asks again each time the page shows, as the browser lets the lock go while hidden, until it stops', async () => {
    const { host, locks, show } = fakeHost()
    const stop = keepScreenOn(host)
    await tick()
    show('hidden')
    await tick()
    expect(locks).toHaveLength(1)
    show('visible')
    await tick()
    expect(locks).toHaveLength(2)
    stop()
    await tick()
    expect(locks.at(-1)?.released).toBe(true)
    show('visible')
    await tick()
    expect(locks).toHaveLength(2)
  })

  it('lets go of a lock granted after it stopped, and goes on without one where the browser refuses', async () => {
    const { host, locks } = fakeHost()
    keepScreenOn(host)()
    await tick()
    expect(locks.map((lock) => lock.released)).toEqual([true])
    const refusing = fakeHost(false)
    const stop = keepScreenOn(refusing.host)
    await tick()
    expect(stop).not.toThrow()
  })
})
