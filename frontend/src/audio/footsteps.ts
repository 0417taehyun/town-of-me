import type { GroundSurface } from '../scene/environment/groundSurface'
import { createNoiseBuffer } from './noiseBuffer'

type FootstepPreset = {
  /** Share of noise samples that are not silent, see `noiseSample`. */
  density: number
  filter: BiquadFilterType
  frequency: number
  resonance: number
  attack: number
  seconds: number
  level: number
}

// A muffled thud on grass, a dry gravelly scuff on the sandy road and plaza, and a slower crackly crunch in snow.
const FOOTSTEP_PRESETS: Record<GroundSurface, FootstepPreset> = {
  grass: { density: 1, filter: 'lowpass', frequency: 760, resonance: 0.8, attack: 0.008, seconds: 0.085, level: 0.75 },
  path: { density: 0.6, filter: 'bandpass', frequency: 1650, resonance: 1.1, attack: 0.004, seconds: 0.07, level: 0.8 },
  snow: { density: 0.14, filter: 'bandpass', frequency: 2300, resonance: 0.75, attack: 0.022, seconds: 0.17, level: 1 },
}
const OUTPUT_GAIN = 0.2
const RUNNING_LOUDNESS = 1.45
const RUNNING_BRIGHTNESS = 1.3
/** Each footfall's pitch lands within this fraction of the preset, so a walk never sounds like one looped sample. */
const PITCH_VARIATION = 0.08
const NOISE_SECONDS = 0.4

export function createFootsteps(context: AudioContext) {
  const output = context.createGain()
  output.gain.value = OUTPUT_GAIN
  output.connect(context.destination)
  const noises = new Map<GroundSurface, AudioBuffer>()
  let disposed = false

  function noiseFor(surface: GroundSurface) {
    const noise = noises.get(surface) ?? createNoiseBuffer(context, NOISE_SECONDS, FOOTSTEP_PRESETS[surface].density)
    noises.set(surface, noise)
    return noise
  }

  function step(surface: GroundSurface, running: boolean) {
    const preset = FOOTSTEP_PRESETS[surface]
    const start = context.currentTime + 0.005
    const level = preset.level * (running ? RUNNING_LOUDNESS : 1)
    const source = context.createBufferSource()
    source.buffer = noiseFor(surface)
    source.playbackRate.value = 1 + (Math.random() * 2 - 1) * PITCH_VARIATION
    const filter = context.createBiquadFilter()
    filter.type = preset.filter
    filter.frequency.value = preset.frequency * (running ? RUNNING_BRIGHTNESS : 1)
    filter.Q.value = preset.resonance
    const envelope = context.createGain()
    envelope.gain.setValueAtTime(0.0001, start)
    envelope.gain.exponentialRampToValueAtTime(level, start + preset.attack)
    envelope.gain.exponentialRampToValueAtTime(0.0001, start + preset.seconds)
    source.connect(filter).connect(envelope).connect(output)
    source.onended = () => [source, filter, envelope].forEach((node) => node.disconnect())
    source.start(start, Math.random() * (NOISE_SECONDS - preset.seconds))
    source.stop(start + preset.seconds + 0.02)
  }

  return {
    /** Plays only while audio is already running; a footfall is never worth asking the browser to resume. */
    play(surface: GroundSurface, running: boolean) {
      if (disposed || context.state !== 'running') return false
      step(surface, running)
      return true
    },
    dispose() {
      disposed = true
      output.disconnect()
    },
  }
}
