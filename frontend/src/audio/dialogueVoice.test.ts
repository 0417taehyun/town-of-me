import { describe, expect, it, vi, type Mock } from 'vitest'
import { createDialogueNotes, createDialogueVoice, getRevealTimes } from './dialogueVoice'

function fakeContext() {
  const oscillators: Array<{
    type: string
    frequency: { setValueAtTime: Mock; exponentialRampToValueAtTime: Mock }
    start: Mock
    stop: Mock
    disconnect: Mock
    onended: (() => void) | null
  }> = []
  const gain = () => ({
    gain: {
      value: 0,
      setValueAtTime: vi.fn(),
      exponentialRampToValueAtTime: vi.fn(),
    },
    connect: vi.fn((destination: unknown) => destination),
    disconnect: vi.fn(),
  })
  const filter = {
    type: '',
    frequency: { value: 0 },
    Q: { value: 0 },
    connect: vi.fn((destination: unknown) => destination),
    disconnect: vi.fn(),
  }
  return {
    state: 'running',
    currentTime: 2,
    destination: {},
    oscillators,
    filter,
    resume: vi.fn(() => Promise.resolve()),
    createGain: vi.fn(gain),
    createBiquadFilter: vi.fn(() => filter),
    createOscillator: vi.fn(() => {
      const oscillator = {
        type: '',
        frequency: { setValueAtTime: vi.fn(), exponentialRampToValueAtTime: vi.fn() },
        connect: vi.fn((destination: unknown) => destination),
        disconnect: vi.fn(),
        start: vi.fn(),
        stop: vi.fn(),
        onended: null,
      }
      oscillators.push(oscillator)
      return oscillator
    }),
  }
}

describe('original cozy dialogue syllables', () => {
  it('creates short deterministic notes for Latin and Korean text with punctuation pauses', () => {
    const first = createDialogueNotes('Hello, 안녕!', 'Maple')
    expect(first).toEqual(createDialogueNotes('Hello, 안녕!', 'Maple'))
    expect(first).toHaveLength(7)
    expect(new Set(first.map(({ duration }) => duration)).size).toBeGreaterThan(1)
    expect(first.every(({ duration }) => duration >= 0.037 && duration <= 0.053)).toBe(true)
    expect(first.at(-1)!.start + first.at(-1)!.duration).toBeLessThan(0.49)
    expect(first.every(({ frequency }) => frequency >= 170 && frequency < 250)).toBe(true)
    expect(createDialogueNotes('Hello', 'Pip')[0].frequency).not.toBe(first[0].frequency)
  })

  it('reveals each voiced character as its syllable starts and the unvoiced tail at the average pace', () => {
    const text = 'Hi, 안녕! Welcome to Mossbell. '.repeat(4)
    const times = getRevealTimes(text)
    expect(times).toHaveLength(Array.from(text).length)
    const syllableStarts = createDialogueNotes(text, 'Maple').map(({ start }) => start)
    const voicedTimes = Array.from(text)
      .slice(0, 72)
      .flatMap((character, index) => (/[\s,.!]/u.test(character) ? [] : [times[index]]))
    expect(voicedTimes).toEqual(syllableStarts)
    const averageSpacing = times[72] / 72
    expect(times[72]).toBeGreaterThan(times[71])
    expect(times[73] - times[72]).toBeCloseTo(averageSpacing)
    expect(times.at(-1)! - times.at(-2)!).toBeCloseTo(averageSpacing)
  })

  it('schedules quiet oscillator syllables and stops them when the bubble closes', async () => {
    const context = fakeContext()
    const voice = createDialogueVoice(context as unknown as AudioContext, context.destination as AudioNode)
    expect(context.createGain.mock.results[0].value.gain.value).toBe(0.16)
    voice.setVolume(3)
    expect(context.createGain.mock.results[0].value.gain.value).toBeCloseTo(0.48)
    expect(await voice.play('Hi!', 'Juno')).toBe(true)
    expect(context.resume).toHaveBeenCalledOnce()
    expect(context.oscillators).toHaveLength(2)
    context.oscillators.forEach((oscillator) => {
      expect(oscillator.type).toBe('triangle')
      expect(oscillator.start).toHaveBeenCalledOnce()
    })
    voice.stop()
    context.oscillators.forEach((oscillator) => expect(oscillator.stop).toHaveBeenCalledTimes(2))
    voice.dispose()
    expect(context.filter.disconnect).toHaveBeenCalledOnce()
    expect(await voice.play('No', 'Juno')).toBe(false)
  })
})
