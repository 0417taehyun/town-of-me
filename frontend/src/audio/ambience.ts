import { clamp01, smoothstep } from '../motionMath'
import type { DayPeriod } from '../scene/environment/dayCycle'
import type { Season } from '../scene/environment/season'
import { createNoiseBuffer } from './noiseBuffer'

/** What the town's ambient sound follows; `null` silences it, as when the town is gone. */
export type AmbientScene = {
  /** Meters from the player to the fountain's rim; `Infinity` without a fountain. */
  fountainDistance: number
  /** How freely the fountain runs, from 1 down to 0 when it freezes. */
  fountainFlow: number
  period: DayPeriod
  season: Season
}

// Levels before the music's master gain, which every ambient sound shares: the music's notes peak at 0.05 to 0.065,
// and a band of noise sounds louder than a tone at the same level, so these stay several times quieter.
const WATER_LEVEL = 0.028
const SPLASH_LEVEL = 0.03
const BIRD_LEVEL = 0.008
const CRICKET_LEVEL = 0.004
/** The fountain is at full level within this many meters of its rim and silent past the far distance. */
const FOUNTAIN_NEAR = 1
const FOUNTAIN_FAR = 20
const LEVEL_EASE_SECONDS = 0.35
const CRICKET_FADE_SECONDS = 1.5
/** Updates arrive a few times a second; chirps are scheduled this far ahead so none are late. */
const LOOKAHEAD_SECONDS = 0.4
const BIRD_PERIODS = new Set<DayPeriod>(['dawn', 'morning', 'noon', 'afternoon'])
const CRICKET_PERIODS = new Set<DayPeriod>(['sunset', 'evening'])
const CRICKET_SEASONS = new Set<Season>(['summer', 'autumn'])

/** How loud the fountain is, 0 to 1: full at its rim, easing away to silence 20 m out. */
export function getFountainLevel(distance: number) {
  const nearness = 1 - smoothstep(clamp01((distance - FOUNTAIN_NEAR) / (FOUNTAIN_FAR - FOUNTAIN_NEAR)))
  return nearness * nearness
}

export function hasBirdsong(scene: AmbientScene | null) {
  return Boolean(scene && BIRD_PERIODS.has(scene.period))
}

export function hasCrickets(scene: AmbientScene | null) {
  return Boolean(scene && CRICKET_PERIODS.has(scene.period) && CRICKET_SEASONS.has(scene.season))
}

/**
 * Fountain water, daytime birdsong, and crickets on summer and autumn evenings, all synthesized into `destination`.
 * It never resumes `context`, so it plays only while the music has the browser's permission to.
 */
export function createAmbience(context: AudioContext, destination: AudioNode) {
  const output = context.createGain()
  output.connect(destination)
  const water = context.createGain()
  water.gain.value = 0
  water.connect(output)
  const crickets = context.createGain()
  crickets.gain.value = 0
  crickets.connect(output)
  let waterTarget = 0
  let cricketTarget = 0
  // The first bird waits a moment instead of greeting the town the instant it opens.
  let nextSongAt = context.currentTime + 3
  let nextChirpAt = 0
  let disposed = false

  // A steady rush of falling water under a sparse patter of drops, each looped from its own length of noise.
  function loopWater(seconds: number, density: number, type: BiquadFilterType, frequency: number, level: number) {
    const source = context.createBufferSource()
    source.buffer = createNoiseBuffer(context, seconds, density)
    source.loop = true
    const filter = context.createBiquadFilter()
    filter.type = type
    filter.frequency.value = frequency
    filter.Q.value = 0.6
    const gain = context.createGain()
    gain.gain.value = level
    source.connect(filter).connect(gain).connect(water)
    source.start()
    return source
  }
  const waterSources = [
    loopWater(2.3, 1, 'bandpass', 900, WATER_LEVEL),
    loopWater(1.7, 0.06, 'highpass', 2600, SPLASH_LEVEL),
  ]

  function chirp(start: number, from: number, to: number, seconds: number, pan: StereoPannerNode) {
    const oscillator = context.createOscillator()
    oscillator.frequency.setValueAtTime(from, start)
    oscillator.frequency.exponentialRampToValueAtTime(to, start + seconds)
    const envelope = context.createGain()
    envelope.gain.setValueAtTime(0.0001, start)
    envelope.gain.exponentialRampToValueAtTime(BIRD_LEVEL, start + seconds * 0.3)
    envelope.gain.exponentialRampToValueAtTime(0.0001, start + seconds)
    oscillator.connect(envelope).connect(pan)
    oscillator.onended = () => [oscillator, envelope].forEach((node) => node.disconnect())
    oscillator.start(start)
    oscillator.stop(start + seconds + 0.02)
    return oscillator
  }

  // A short phrase of whistled notes swooping up and down, from one bird somewhere off to one side.
  function sing(start: number) {
    const pan = context.createStereoPanner()
    pan.pan.value = Math.random() * 1.4 - 0.7
    pan.connect(output)
    const pitch = 2600 + Math.random() * 1800
    const rise = 1.15 + Math.random() * 0.25
    const notes = Array.from({ length: 2 + Math.floor(Math.random() * 4) }, (_, index) =>
      chirp(
        start + index * (0.13 + Math.random() * 0.05),
        index % 2 ? pitch * rise : pitch,
        index % 2 ? pitch : pitch * rise,
        0.07 + Math.random() * 0.05,
        pan,
      ),
    )
    notes[notes.length - 1].addEventListener('ended', () => pan.disconnect())
  }

  // A cricket's chirp: three quick pulses of one high tone.
  function cricketChirp(start: number) {
    const oscillator = context.createOscillator()
    oscillator.frequency.value = 4200 + Math.random() * 500
    const envelope = context.createGain()
    envelope.gain.setValueAtTime(0, start)
    ;[0, 1, 2].forEach((pulse) => {
      const pulseStart = start + pulse * 0.034
      envelope.gain.setValueAtTime(0, pulseStart)
      envelope.gain.linearRampToValueAtTime(CRICKET_LEVEL, pulseStart + 0.006)
      envelope.gain.linearRampToValueAtTime(0, pulseStart + 0.022)
    })
    oscillator.connect(envelope).connect(crickets)
    oscillator.onended = () => [oscillator, envelope].forEach((node) => node.disconnect())
    oscillator.start(start)
    oscillator.stop(start + 0.12)
  }

  // Only a real change is written, so a steady scene does not pile up automation events.
  function easeWater(level: number, now: number) {
    if (Math.abs(level - waterTarget) < 0.002) return
    waterTarget = level
    water.gain.setTargetAtTime(level, now, LEVEL_EASE_SECONDS)
  }

  function easeCrickets(level: number, now: number) {
    if (level === cricketTarget) return
    cricketTarget = level
    crickets.gain.setTargetAtTime(level, now, CRICKET_FADE_SECONDS)
  }

  function scheduleSong(now: number) {
    nextSongAt = Math.max(nextSongAt, now)
    if (nextSongAt > now + LOOKAHEAD_SECONDS) return
    sing(nextSongAt)
    nextSongAt += 4 + Math.random() * 9
  }

  function scheduleCrickets(now: number) {
    nextChirpAt = Math.max(nextChirpAt, now)
    while (nextChirpAt < now + LOOKAHEAD_SECONDS) {
      cricketChirp(nextChirpAt)
      nextChirpAt += 0.45 + Math.random() * 0.4
    }
  }

  return {
    /** Call a few times a second; the water eases to its new level and calls are scheduled just ahead. */
    update(scene: AmbientScene | null) {
      if (disposed) return
      const now = context.currentTime
      easeWater(scene ? getFountainLevel(scene.fountainDistance) * clamp01(scene.fountainFlow) : 0, now)
      easeCrickets(Number(hasCrickets(scene)), now)
      if (context.state !== 'running') return
      if (hasBirdsong(scene)) scheduleSong(now)
      if (hasCrickets(scene)) scheduleCrickets(now)
    },
    dispose() {
      disposed = true
      waterSources.forEach((source) => source.stop())
      output.disconnect()
    },
  }
}
