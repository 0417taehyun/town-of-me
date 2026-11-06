import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest'
import { createCozyMusic } from './cozyMusic'
import { createBark } from './bark'
import { createPant } from './pant'

function fakeAudioContext() {
  const gain = {
    gain: { value: 0, setValueAtTime: vi.fn(), exponentialRampToValueAtTime: vi.fn() },
    connect: vi.fn(),
    disconnect: vi.fn(),
  }
  return {
    state: 'suspended',
    currentTime: 0,
    destination: {},
    onstatechange: null as (() => void) | null,
    createGain: vi.fn(() => gain),
    createOscillator: vi.fn(() => ({
      frequency: { value: 0 },
      connect: vi.fn(() => gain),
      disconnect: vi.fn(),
      start: vi.fn(),
      stop: vi.fn(),
    })),
    resume: vi.fn(() => Promise.resolve()),
    suspend: vi.fn(() => Promise.resolve()),
    close: vi.fn(() => Promise.resolve()),
  }
}

beforeEach(() => vi.useFakeTimers())
afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('music lifecycle', () => {
  it('resumes synchronously, reports blocked until actually running, and schedules only once', async () => {
    const context = fakeAudioContext()
    vi.stubGlobal(
      'AudioContext',
      vi.fn(function () {
        return context
      }),
    )
    const status = vi.fn()
    const music = createCozyMusic('morning', status)
    expect(context.createGain.mock.results[0].value.gain.value).toBe(1)
    music.setVolume(1.5)
    expect(context.createGain.mock.results[0].value.gain.value).toBe(1.5)
    music.setVolume(5)
    expect(context.createGain.mock.results[0].value.gain.value).toBe(2)
    music.setVolume(-1)
    expect(context.createGain.mock.results[0].value.gain.value).toBe(0)
    music.setVolume(1)
    const started = music.start()
    expect(context.resume).toHaveBeenCalledOnce()
    expect(status).toHaveBeenLastCalledWith('blocked')
    expect(context.createOscillator).not.toHaveBeenCalled()
    await started
    context.state = 'running'
    context.onstatechange?.()
    expect(status).toHaveBeenLastCalledWith('playing')
    expect(context.createOscillator).toHaveBeenCalled()
    expect(context.createGain.mock.results[0].value.gain.exponentialRampToValueAtTime).toHaveBeenCalledWith(
      0.05,
      expect.any(Number),
    )
    expect(context.createGain.mock.results[0].value.gain.exponentialRampToValueAtTime).toHaveBeenCalledWith(
      0.065,
      expect.any(Number),
    )
    await music.start()
    expect(vi.getTimerCount()).toBe(1)
    context.state = 'suspended'
    context.onstatechange?.()
    expect(status).toHaveBeenLastCalledWith('blocked')
    expect(vi.getTimerCount()).toBe(0)
    music.dispose()
  })

  it('does not let a closed StrictMode instance publish after the fresh instance starts', async () => {
    const first = fakeAudioContext()
    const second = fakeAudioContext()
    let finishOldResume: () => void = () => undefined
    first.resume.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          finishOldResume = resolve
        }),
    )
    vi.stubGlobal(
      'AudioContext',
      vi
        .fn()
        .mockImplementationOnce(function () {
          return first
        })
        .mockImplementationOnce(function () {
          return second
        }),
    )
    const status = vi.fn()
    const oldMusic = createCozyMusic('morning', status)
    const oldStart = oldMusic.start()
    oldMusic.dispose()
    const music = createCozyMusic('morning', status)
    second.state = 'running'
    await music.start()
    status.mockClear()
    finishOldResume()
    await oldStart
    expect(first.close).toHaveBeenCalledOnce()
    expect(first.onstatechange).toBeNull()
    expect(status).not.toHaveBeenCalled()
    expect(vi.getTimerCount()).toBe(1)
    music.pause()
    expect(status).toHaveBeenLastCalledWith('paused')
    second.onstatechange?.()
    expect(vi.getTimerCount()).toBe(0)
    music.dispose()
  })
})

describe('pet greeting', () => {
  it('plays two quiet differently pitched woofs, ignores overlapping requests, and cancels on cleanup', async () => {
    const audio = {
      volume: 1,
      playbackRate: 1,
      currentTime: 0,
      preservesPitch: true,
      play: vi.fn(() => Promise.resolve()),
      pause: vi.fn(),
      onended: null as (() => void) | null,
      onerror: null,
    }
    vi.stubGlobal(
      'Audio',
      vi.fn(function () {
        return audio
      }),
    )
    const bark = createBark('/bark.mp3')
    await Promise.all([bark.play(), bark.play(), bark.play()])
    expect(audio.play).toHaveBeenCalledOnce()
    expect(audio.volume).toBe(0.012)
    expect(audio.preservesPitch).toBe(false)
    const firstRate = audio.playbackRate
    audio.onended?.()
    await bark.play()
    await vi.advanceTimersByTimeAsync(129)
    expect(audio.play).toHaveBeenCalledOnce()
    await vi.advanceTimersByTimeAsync(1)
    expect(audio.play).toHaveBeenCalledTimes(2)
    expect(audio.volume).toBe(0.009)
    expect(audio.playbackRate).toBeGreaterThan(firstRate)
    bark.setVolume(2)
    expect(audio.volume).toBe(0.018)
    audio.onended?.()
    await bark.play()
    audio.onended?.()
    bark.dispose()
    await vi.runAllTimersAsync()
    expect(audio.play).toHaveBeenCalledTimes(3)
    expect(audio.pause).toHaveBeenCalledOnce()
  })

  it('cancels a pending second woof when petting interrupts a greeting', async () => {
    const audio = { play: vi.fn(() => Promise.resolve()), pause: vi.fn(), onended: null as (() => void) | null }
    vi.stubGlobal(
      'Audio',
      vi.fn(function () {
        return audio
      }),
    )
    const bark = createBark('/bark.mp3')
    await bark.play()
    audio.onended?.()
    bark.stop()
    await vi.runAllTimersAsync()
    expect(audio.play).toHaveBeenCalledOnce()
    await bark.play()
    expect(audio.play).toHaveBeenCalledTimes(2)
    bark.dispose()
  })
})

function fakePantContext() {
  const gain = { gain: { value: 1 }, connect: vi.fn(), disconnect: vi.fn() }
  const filter = { type: '', frequency: { value: 0 }, Q: { value: 0 }, connect: vi.fn(() => gain), disconnect: vi.fn() }
  const buffer = { copyToChannel: vi.fn() }
  const sources: {
    playbackRate: { value: number }
    start: Mock
    stop: Mock
    connect: Mock
    disconnect: Mock
    onended: (() => void) | null
  }[] = []
  return {
    state: 'running',
    sampleRate: 48000,
    currentTime: 10,
    destination: {},
    gain,
    filter,
    sources,
    resume: vi.fn(() => Promise.resolve()),
    createBuffer: vi.fn(() => buffer),
    createGain: () => gain,
    createBiquadFilter: () => filter,
    createBufferSource: () => {
      const source = {
        playbackRate: { value: 1 },
        connect: vi.fn(),
        disconnect: vi.fn(),
        start: vi.fn(),
        stop: vi.fn(),
        onended: null,
      }
      sources.push(source)
      return source
    },
  }
}

describe('original procedural pet pant', () => {
  it('schedules four subtle breaths once and cancels every source on greeting or cleanup', async () => {
    const context = fakePantContext()
    const pant = createPant(context as unknown as AudioContext)
    const playing = pant.play()
    expect(context.resume).toHaveBeenCalledOnce()
    await Promise.all([playing, pant.play(), pant.play()])
    expect(context.sources).toHaveLength(4)
    expect(context.sources.map((source) => source.start.mock.calls[0][0])).toEqual([10, 10.23, 10.5, 10.73])
    expect(context.gain.gain.value).toBe(0.025)
    pant.setVolume(2)
    expect(context.gain.gain.value).toBe(0.05)
    pant.setVolume(10)
    expect(context.gain.gain.value).toBe(0.2)
    expect(context.filter.type).toBe('bandpass')
    pant.stop()
    context.sources.forEach((source) => {
      expect(source.stop).toHaveBeenCalledOnce()
      expect(source.disconnect).toHaveBeenCalledOnce()
      expect(source.onended).toBeNull()
    })
    await pant.play()
    expect(context.sources).toHaveLength(8)
    pant.dispose()
    expect(context.filter.disconnect).toHaveBeenCalledOnce()
    expect(context.gain.disconnect).toHaveBeenCalledOnce()
    expect(await pant.play()).toBe(false)
  })

  it('does not schedule after a pending resume is stopped, or while the browser remains blocked', async () => {
    const context = fakePantContext()
    let finishResume: () => void = () => undefined
    context.resume.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          finishResume = resolve
        }),
    )
    const pant = createPant(context as unknown as AudioContext)
    const pending = pant.play()
    pant.stop()
    finishResume()
    expect(await pending).toBe(false)
    expect(context.sources).toHaveLength(0)
    context.state = 'suspended'
    expect(await pant.play()).toBe(false)
    expect(context.sources).toHaveLength(0)
    context.state = 'running'
    expect(await pant.play()).toBe(true)
    pant.dispose()
  })
})
