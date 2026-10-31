import { describe, expect, it, vi } from 'vitest'
import { createAmbience, getFountainLevel, type AmbientScene } from './ambience'

function fakeParam() {
  return {
    value: 0,
    setTargetAtTime: vi.fn(),
    setValueAtTime: vi.fn(),
    exponentialRampToValueAtTime: vi.fn(),
    linearRampToValueAtTime: vi.fn(),
  }
}

function fakeNode<Fields extends object>(fields: Fields) {
  return {
    ...fields,
    connect: vi.fn((target: unknown) => target),
    disconnect: vi.fn(),
    start: vi.fn(),
    stop: vi.fn(),
    addEventListener: vi.fn(),
  }
}

function fakeAudioContext() {
  return {
    state: 'suspended',
    currentTime: 0,
    sampleRate: 100,
    destination: fakeNode({}),
    resume: vi.fn(() => Promise.resolve()),
    createGain: vi.fn(() => fakeNode({ gain: fakeParam() })),
    createBiquadFilter: vi.fn(() => fakeNode({ type: '', frequency: fakeParam(), Q: fakeParam() })),
    createBufferSource: vi.fn(() => fakeNode({ buffer: null, loop: false })),
    createBuffer: vi.fn((_channels: number, length: number) => ({ getChannelData: () => new Float32Array(length) })),
    createOscillator: vi.fn(() => fakeNode({ frequency: fakeParam() })),
    createStereoPanner: vi.fn(() => fakeNode({ pan: fakeParam() })),
  }
}

const summerEvening: AmbientScene = { fountainDistance: 4, fountainFlow: 1, period: 'evening', season: 'summer' }

describe('ambient sound', () => {
  it('is loudest at the fountain rim, fades with distance, and is silent across town', () => {
    expect(getFountainLevel(0)).toBe(1)
    expect(getFountainLevel(5)).toBeLessThan(1)
    expect(getFountainLevel(10)).toBeLessThan(getFountainLevel(5))
    expect(getFountainLevel(10)).toBeGreaterThan(0)
    expect(getFountainLevel(30)).toBe(0)
    expect(getFountainLevel(Infinity)).toBe(0)
  })

  it('never resumes the audio itself and schedules no calls until the music is playing', () => {
    const context = fakeAudioContext()
    const ambience = createAmbience(context as unknown as AudioContext, context.destination as unknown as AudioNode)
    ambience.update(summerEvening)
    ambience.update({ ...summerEvening, period: 'morning' })
    expect(context.resume).not.toHaveBeenCalled()
    expect(context.createOscillator).not.toHaveBeenCalled()
    context.state = 'running'
    context.currentTime = 10
    ambience.update(summerEvening)
    expect(context.createOscillator).toHaveBeenCalled()
    expect(context.resume).not.toHaveBeenCalled()
  })
})
