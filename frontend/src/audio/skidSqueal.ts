import { clamp } from '../motionMath'
import { createNoiseBuffer } from './noiseBuffer'

export type SkidSound = 'skid' | 'brake'
export type SquealLength = 'long' | 'short'

// A sneaker sliding on gravel: a sawtooth squeal sweeping down through a narrow band-pass with a fast vibrato, over a
// bright scrape and a low rumble of dirt. The long skid's "끼이익" sweeps lower and longer than the short "끽!".
const squeals = {
  long: {
    voice: { from: 2100, to: 880, seconds: 0.4, vibratoRate: 31, vibratoDepth: 190, resonance: 5, level: 0.3 },
    scrape: { frequency: 2200, resonance: 0.9, seconds: 0.46, level: 0.38 },
    dirt: { frequency: 380, seconds: 0.45, level: 0.36 },
  },
  short: {
    voice: { from: 2350, to: 1250, seconds: 0.17, vibratoRate: 46, vibratoDepth: 110, resonance: 7, level: 0.34 },
    scrape: { frequency: 2600, resonance: 1.1, seconds: 0.2, level: 0.32 },
    dirt: { frequency: 520, seconds: 0.18, level: 0.28 },
  },
} satisfies Record<SquealLength, unknown>
const OUTPUT_GAIN = 0.45
const BRAKE_STRETCH = 1.15

export function createSkidSqueal(context: AudioContext) {
  const output = context.createGain()
  output.gain.value = OUTPUT_GAIN
  output.connect(context.destination)
  const noise = createNoiseBuffer(context, 0.6)
  let disposed = false

  function noiseBurst(
    type: BiquadFilterType,
    frequency: number,
    resonance: number,
    start: number,
    seconds: number,
    level: number,
  ) {
    const source = context.createBufferSource()
    source.buffer = noise
    const filter = context.createBiquadFilter()
    filter.type = type
    filter.frequency.value = frequency
    filter.Q.value = resonance
    const envelope = context.createGain()
    envelope.gain.setValueAtTime(0.0001, start)
    envelope.gain.exponentialRampToValueAtTime(level, start + 0.012)
    envelope.gain.exponentialRampToValueAtTime(0.0001, start + seconds)
    source.connect(filter).connect(envelope).connect(output)
    source.onended = () => [source, filter, envelope].forEach((node) => node.disconnect())
    source.start(start, Math.random() * 0.1)
    source.stop(start + seconds + 0.02)
  }

  function squeal(kind: SkidSound, intensity: number, length: SquealLength) {
    const { voice, scrape, dirt } = squeals[length]
    const start = context.currentTime + 0.01
    const stretch = kind === 'brake' ? BRAKE_STRETCH : 1
    const seconds = voice.seconds * stretch
    const level = voice.level * intensity
    const oscillator = context.createOscillator()
    oscillator.type = 'sawtooth'
    oscillator.frequency.setValueAtTime(voice.from, start)
    oscillator.frequency.exponentialRampToValueAtTime(voice.to, start + seconds)
    const vibrato = context.createOscillator()
    vibrato.frequency.value = voice.vibratoRate
    const vibratoDepth = context.createGain()
    vibratoDepth.gain.value = voice.vibratoDepth
    vibrato.connect(vibratoDepth).connect(oscillator.frequency)
    const band = context.createBiquadFilter()
    band.type = 'bandpass'
    band.Q.value = voice.resonance
    band.frequency.setValueAtTime(voice.from, start)
    band.frequency.exponentialRampToValueAtTime(voice.to, start + seconds)
    const envelope = context.createGain()
    envelope.gain.setValueAtTime(0.0001, start)
    envelope.gain.exponentialRampToValueAtTime(level, start + 0.008)
    envelope.gain.setValueAtTime(level, start + seconds * 0.55)
    envelope.gain.exponentialRampToValueAtTime(0.0001, start + seconds)
    oscillator.connect(band).connect(envelope).connect(output)
    oscillator.onended = () => [oscillator, vibrato, vibratoDepth, band, envelope].forEach((node) => node.disconnect())
    ;[oscillator, vibrato].forEach((node) => {
      node.start(start)
      node.stop(start + seconds + 0.03)
    })
    noiseBurst('bandpass', scrape.frequency, scrape.resonance, start, scrape.seconds * stretch, level * scrape.level)
    noiseBurst('lowpass', dirt.frequency, 0.7, start, dirt.seconds * stretch, level * dirt.level)
  }

  return {
    /** `intensity` scales with how fast the player was running, from about 0.45 to 1. */
    async play(kind: SkidSound, intensity: number, length: SquealLength = 'long') {
      if (disposed) return false
      try {
        await context.resume()
      } catch {
        return false
      }
      if (disposed || context.state !== 'running') return false
      squeal(kind, clamp(intensity, 0, 1.05), length)
      return true
    },
    dispose() {
      disposed = true
      output.disconnect()
    },
  }
}
