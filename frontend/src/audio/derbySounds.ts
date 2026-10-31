import { createNoiseBuffer } from './noiseBuffer'

// The derby's sounds, all synthesized: a burst of filtered noise with a short tone under it for the crack of the bat
// and the pop of the mitt, and a long swell of noise for the crowd. They are cues only; the captions say the same.

export type DerbySound = 'bat' | 'mitt' | 'crowd'

/** A filtered noise burst rising over `attackSeconds` and fading by `seconds`, with an optional tone (Hz) under it. */
export type StruckNoise = {
  filter: BiquadFilterType
  frequency: number
  resonance: number
  level: number
  attackSeconds: number
  seconds: number
  tone: number | null
}

export const DERBY_SOUNDS = {
  bat: {
    filter: 'highpass',
    frequency: 1400,
    resonance: 0.7,
    level: 0.8,
    attackSeconds: 0.002,
    seconds: 0.08,
    tone: 1900,
  },
  mitt: { filter: 'lowpass', frequency: 900, resonance: 1, level: 0.7, attackSeconds: 0.002, seconds: 0.1, tone: 140 },
  crowd: {
    filter: 'bandpass',
    frequency: 1100,
    resonance: 0.4,
    level: 0.25,
    attackSeconds: 0.35,
    seconds: 2.6,
    tone: null,
  },
} satisfies Record<DerbySound, StruckNoise>

const NOISE_SECONDS = 1

/**
 * The derby's sounds on one audio context, made at the first `unlock`: browsers start audio only from a click or a
 * key press, so the page calls it from the one that starts a run. Until the context runs, `play` stays silent.
 */
export function createDerbySounds(createContext: () => AudioContext = () => new AudioContext()) {
  let context: AudioContext | null = null
  let noise: AudioBuffer | null = null
  return {
    unlock() {
      try {
        context ??= createContext()
        noise ??= createNoiseBuffer(context, NOISE_SECONDS)
        context.resume().catch(() => undefined)
      } catch {
        context = null
      }
    },
    play(sound: DerbySound) {
      if (!context || !noise || context.state !== 'running') return false
      playStruckNoise(context, noise, DERBY_SOUNDS[sound])
      return true
    },
    dispose() {
      context?.close().catch(() => undefined)
      context = null
      noise = null
    },
  }
}

export function playStruckNoise(context: AudioContext, noise: AudioBuffer, sound: StruckNoise) {
  const start = context.currentTime
  const end = start + sound.seconds
  const source = context.createBufferSource()
  source.buffer = noise
  source.loop = true
  const filter = context.createBiquadFilter()
  filter.type = sound.filter
  filter.frequency.value = sound.frequency
  filter.Q.value = sound.resonance
  const envelope = context.createGain()
  envelope.gain.setValueAtTime(0.0001, start)
  envelope.gain.exponentialRampToValueAtTime(sound.level, start + sound.attackSeconds)
  envelope.gain.exponentialRampToValueAtTime(0.0001, end)
  source.connect(filter).connect(envelope).connect(context.destination)
  source.onended = () => [source, filter, envelope].forEach((node) => node.disconnect())
  source.start(start)
  source.stop(end + 0.02)
  if (sound.tone !== null) playTone(context, sound.tone, sound.level * 0.4, start, sound.seconds * 1.4)
}

export function playTone(context: AudioContext, frequency: number, level: number, start: number, seconds: number) {
  const oscillator = context.createOscillator()
  oscillator.frequency.value = frequency
  const envelope = context.createGain()
  envelope.gain.setValueAtTime(level, start)
  envelope.gain.exponentialRampToValueAtTime(0.0001, start + seconds)
  oscillator.connect(envelope).connect(context.destination)
  oscillator.onended = () => [oscillator, envelope].forEach((node) => node.disconnect())
  oscillator.start(start)
  oscillator.stop(start + seconds + 0.02)
}
