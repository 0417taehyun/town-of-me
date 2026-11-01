import { describe, expect, it, vi, type Mock } from 'vitest'
import { createDerbySounds } from './derbySounds'

const param = () => ({ value: 0, setValueAtTime: vi.fn(), exponentialRampToValueAtTime: vi.fn() })
const node = () => ({ connect: vi.fn((next: unknown) => next), disconnect: vi.fn() })

function fakeContext() {
  const sources: Array<{ start: Mock }> = []
  const oscillators: Array<{ start: Mock }> = []
  return {
    state: 'suspended',
    sampleRate: 8000,
    currentTime: 1,
    destination: {},
    sources,
    oscillators,
    resume: vi.fn(() => Promise.resolve()),
    close: vi.fn(() => Promise.resolve()),
    createGain: () => ({ ...node(), gain: param() }),
    createBiquadFilter: () => ({ ...node(), type: '', frequency: param(), Q: param() }),
    createBuffer: (_channels: number, length: number) => ({ getChannelData: () => new Float32Array(length) }),
    createBufferSource: () => {
      const source = { ...node(), buffer: null, loop: false, start: vi.fn(), stop: vi.fn(), onended: null }
      sources.push(source)
      return source
    },
    createOscillator: () => {
      const oscillator = { ...node(), type: '', frequency: param(), start: vi.fn(), stop: vi.fn(), onended: null }
      oscillators.push(oscillator)
      return oscillator
    },
  }
}

describe('the derby sounds', () => {
  it('make no audio context before the first click, and stay silent until the browser lets it run', () => {
    const context = fakeContext()
    const createContext = vi.fn(() => context as unknown as AudioContext)
    const sounds = createDerbySounds(createContext)
    expect(sounds.play('bat')).toBe(false)
    expect(createContext).not.toHaveBeenCalled()
    sounds.unlock()
    expect(context.resume).toHaveBeenCalledOnce()
    expect(sounds.play('bat')).toBe(false)
    context.state = 'running'
    expect(sounds.play('bat')).toBe(true)
    expect(context.sources).toHaveLength(1)
    expect(context.sources[0].start).toHaveBeenCalledOnce()
  })

  it('play a chime as its tones alone, without the noise the struck sounds burst from', () => {
    const context = fakeContext()
    const sounds = createDerbySounds(() => context as unknown as AudioContext)
    sounds.unlock()
    context.state = 'running'
    expect(sounds.play('away')).toBe(true)
    expect(context.sources).toHaveLength(0)
    expect(context.oscillators.map((oscillator) => oscillator.start.mock.calls[0][0])).toEqual([1, 1.22])
  })
})
