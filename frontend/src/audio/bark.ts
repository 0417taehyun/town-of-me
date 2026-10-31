import { clamp } from '../motionMath'

/** The second woof of a greeting is a little quieter than the first. */
export function woofVolume(woof: number, volumeScale: number) {
  return (woof === 0 ? 0.012 : 0.009) * volumeScale
}

export function createBark(url: string) {
  const audio = new Audio(url)
  audio.preload = 'auto'
  audio.preservesPitch = false
  let busy = false
  let disposed = false
  let gap: ReturnType<typeof setTimeout> | undefined
  let woof = 0
  let generation = 0
  let volumeScale = 1

  async function playWoof() {
    const request = generation
    audio.volume = woofVolume(woof, volumeScale)
    audio.playbackRate = woof === 0 ? 1.16 : 1.26
    audio.currentTime = 0
    try {
      await audio.play()
      return !disposed && request === generation
    } catch {
      return releaseIfCurrent(request)
    }
  }

  function releaseIfCurrent(request: number) {
    if (request === generation) busy = false
    return false
  }

  audio.onended = () => {
    if (!busy || disposed) return
    if (woof === 1) {
      busy = false
      return
    }
    woof = 1
    gap = setTimeout(() => void playWoof(), 130)
  }
  audio.onerror = () => {
    clearTimeout(gap)
    busy = false
  }

  function stop() {
    generation += 1
    clearTimeout(gap)
    audio.pause()
    busy = false
  }

  return {
    play() {
      if (disposed) return Promise.resolve(false)
      // Finish one greeting before accepting another, including while play() is pending.
      if (busy) return Promise.resolve(true)
      busy = true
      generation += 1
      woof = 0
      return playWoof()
    },
    setVolume(nextVolume: number) {
      volumeScale = clamp(nextVolume, 0, 8)
      audio.volume = woofVolume(woof, volumeScale)
    },
    stop,
    dispose() {
      disposed = true
      stop()
      audio.onended = null
      audio.onerror = null
    },
  }
}
