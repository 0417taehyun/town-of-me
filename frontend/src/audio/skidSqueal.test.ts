import { describe, expect, it, vi, type Mock } from 'vitest'
import { createSkidSqueal } from './skidSqueal'

const param = () => ({ value: 0, setValueAtTime: vi.fn(), exponentialRampToValueAtTime: vi.fn() })
const node = () => ({ connect: vi.fn((next: unknown) => next), disconnect: vi.fn() })

function fakeSkidContext() {
  const oscillators: Array<ReturnType<typeof node> & { frequency: ReturnType<typeof param>; stop: Mock }> = []
  return {
    state: 'running',
    sampleRate: 8000,
    currentTime: 2,
    destination: {},
    oscillators,
    resume: vi.fn(() => Promise.resolve()),
    createGain: () => ({ ...node(), gain: param() }),
    createBiquadFilter: () => ({ ...node(), type: '', frequency: param(), Q: param() }),
    createBuffer: (_channels: number, length: number) => ({ getChannelData: () => new Float32Array(length) }),
    createBufferSource: () => ({ ...node(), buffer: null, start: vi.fn(), stop: vi.fn(), onended: null }),
    createOscillator: () => {
      const oscillator = { ...node(), type: '', frequency: param(), start: vi.fn(), stop: vi.fn(), onended: null }
      oscillators.push(oscillator)
      return oscillator
    },
  }
}

describe('the long skid squeal', () => {
  it('stays silent while the browser blocks audio and after cleanup', async () => {
    const context = fakeSkidContext()
    const squeal = createSkidSqueal(context as unknown as AudioContext)
    context.state = 'suspended'
    expect(await squeal.play('skid', 1)).toBe(false)
    expect(context.oscillators).toHaveLength(0)
    context.state = 'running'
    squeal.dispose()
    expect(await squeal.play('skid', 1)).toBe(false)
    expect(context.oscillators).toHaveLength(0)
  })
})
