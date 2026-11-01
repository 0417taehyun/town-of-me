import { createNoiseBuffer } from './noiseBuffer'

// The derby's sounds, all synthesized: a burst of filtered noise with a short tone under it for the crack of the bat
// and the pop of the mitt, a long swell of noise for the crowd, and softer puffs for the pitch leaving the hand and
// the bat cutting the air; and short tones for the pitcher's windup, the stance gauge's seconds and its filling, the
// camera locking on, and the visitor stepping out of its view. They are cues only, kept quiet beside the bat and the
// crowd; the captions say the same.

export type DerbySound = StruckSound | ChimeSound
export type StruckSound = 'bat' | 'mitt' | 'crowd' | 'release' | 'whoosh'
export type ChimeSound = 'windup' | 'tick' | 'ding' | 'lock' | 'away'

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
  release: {
    filter: 'bandpass',
    frequency: 2400,
    resonance: 1.4,
    level: 0.12,
    attackSeconds: 0.01,
    seconds: 0.12,
    tone: null,
  },
  whoosh: {
    filter: 'bandpass',
    frequency: 850,
    resonance: 0.9,
    level: 0.22,
    attackSeconds: 0.08,
    seconds: 0.26,
    tone: null,
  },
} satisfies Record<StruckSound, StruckNoise>

/** A tone of `wave` gliding from `frequency` to `to` (Hz), starting `at` seconds in at `level` and fading by `seconds`. */
export type ChimeNote = {
  wave: OscillatorType
  frequency: number
  to: number
  level: number
  at: number
  seconds: number
}

export const DERBY_CHIMES = {
  // A referee's short rising whistle as the pitcher winds up.
  windup: [{ wave: 'sine', frequency: 2100, to: 2600, level: 0.05, at: 0, seconds: 0.3 }],
  tick: [{ wave: 'sine', frequency: 1760, to: 1760, level: 0.07, at: 0, seconds: 0.05 }],
  ding: [
    { wave: 'sine', frequency: 1320, to: 1320, level: 0.1, at: 0, seconds: 0.7 },
    { wave: 'sine', frequency: 2640, to: 2640, level: 0.03, at: 0, seconds: 0.4 },
  ],
  lock: [
    { wave: 'sine', frequency: 880, to: 880, level: 0.08, at: 0, seconds: 0.2 },
    { wave: 'sine', frequency: 1320, to: 1320, level: 0.08, at: 0.09, seconds: 0.35 },
  ],
  // Low and falling, unlike every other cue, so it reads as "something is wrong" without looking.
  away: [
    { wave: 'triangle', frequency: 392, to: 392, level: 0.12, at: 0, seconds: 0.22 },
    { wave: 'triangle', frequency: 294, to: 294, level: 0.12, at: 0.22, seconds: 0.32 },
  ],
} satisfies Record<ChimeSound, ChimeNote[]>

export function isChime(sound: DerbySound): sound is ChimeSound {
  return sound in DERBY_CHIMES
}

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
      if (isChime(sound)) {
        playChime(context, DERBY_CHIMES[sound])
        return true
      }
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

export function playChime(context: AudioContext, notes: ChimeNote[]) {
  const start = context.currentTime
  notes.forEach((note) => playNote(context, note, start))
}

/** `note` from `start` (the context's seconds), soft at its onset so it does not click. */
export function playNote(context: AudioContext, note: ChimeNote, start: number) {
  const begin = start + note.at
  const end = begin + note.seconds
  const oscillator = context.createOscillator()
  oscillator.type = note.wave
  oscillator.frequency.setValueAtTime(note.frequency, begin)
  oscillator.frequency.exponentialRampToValueAtTime(note.to, end)
  const envelope = context.createGain()
  envelope.gain.setValueAtTime(0.0001, begin)
  envelope.gain.exponentialRampToValueAtTime(note.level, begin + 0.004)
  envelope.gain.exponentialRampToValueAtTime(0.0001, end)
  oscillator.connect(envelope).connect(context.destination)
  oscillator.onended = () => [oscillator, envelope].forEach((node) => node.disconnect())
  oscillator.start(begin)
  oscillator.stop(end + 0.02)
}
