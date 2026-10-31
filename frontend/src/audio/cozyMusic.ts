import { clamp } from '../motionMath'
import { dayPeriods, type DayPeriod } from '../scene/environment/dayCycle'
import { createPant } from './pant'
import { createDialogueVoice } from './dialogueVoice'
import { createSkidSqueal, type SkidSound, type SquealLength } from './skidSqueal'
import { createFootsteps } from './footsteps'
import { createAmbience, type AmbientScene } from './ambience'
import type { GroundSurface } from '../scene/environment/groundSurface'

export type MusicStatus = 'playing' | 'paused' | 'blocked' | 'unavailable'

const chords = [
  [261.63, 329.63, 392],
  [220, 261.63, 329.63],
  [174.61, 220, 261.63],
  [196, 246.94, 293.66],
]

const MUSIC_GAIN = 1
const MAX_MUSIC_GAIN = 2
const MELODY_GAIN = 0.05
const BASS_GAIN = 0.065

export function createCozyMusic(period: DayPeriod, onStatus: (status: MusicStatus) => void) {
  const context = new AudioContext()
  const master = context.createGain()
  master.gain.value = MUSIC_GAIN
  master.connect(context.destination)
  let timer: ReturnType<typeof setInterval> | undefined
  let beat = 0
  let nextBeat = 0
  let wanted = true
  let volume = MUSIC_GAIN
  let petVolume = 1
  let residentVolume = 6
  let disposed = false
  let pant: ReturnType<typeof createPant> | undefined
  let dialogueVoice: ReturnType<typeof createDialogueVoice> | undefined
  let skidSqueal: ReturnType<typeof createSkidSqueal> | undefined
  let footsteps: ReturnType<typeof createFootsteps> | undefined
  let ambience: ReturnType<typeof createAmbience> | undefined

  function note(frequency: number, start: number, duration: number, volume: number) {
    const oscillator = context.createOscillator()
    const gain = context.createGain()
    oscillator.type = frequency < 200 ? 'sine' : 'triangle'
    oscillator.frequency.value = frequency
    gain.gain.setValueAtTime(0.0001, start)
    gain.gain.exponentialRampToValueAtTime(volume, start + 0.04)
    gain.gain.exponentialRampToValueAtTime(0.0001, start + duration)
    oscillator.connect(gain).connect(master)
    oscillator.onended = () => {
      oscillator.disconnect()
      gain.disconnect()
    }
    oscillator.start(start)
    oscillator.stop(start + duration + 0.05)
  }

  function scheduleBeat() {
    const arrangement = dayPeriods[period]
    const chord = chords[Math.floor(beat / 8) % chords.length]
    const transpose = 2 ** (arrangement.transpose / 12)
    const degree = arrangement.melody[beat % arrangement.melody.length]
    const frequency = chord[degree % chord.length] * 2 ** Math.floor(degree / chord.length) * transpose
    note(frequency, nextBeat, arrangement.tempo * 1.35, MELODY_GAIN)
    if (beat % 4 === 0) note((chord[0] / 2) * transpose, nextBeat, arrangement.tempo * 3, BASS_GAIN)
    beat += 1
    nextBeat += arrangement.tempo
  }

  function schedule() {
    // Background tabs can delay timers: skip missed beats instead of playing a burst.
    nextBeat = Math.max(nextBeat, context.currentTime)
    while (nextBeat < context.currentTime + 0.5) scheduleBeat()
  }

  function publishState() {
    if (disposed) return
    master.gain.value = wanted ? volume : 0
    if (context.state !== 'running' || !wanted) {
      clearInterval(timer)
      timer = undefined
      onStatus(wanted ? 'blocked' : 'paused')
      return
    }
    if (timer === undefined) {
      nextBeat = context.currentTime + 0.05
      schedule()
      timer = setInterval(schedule, 120)
    }
    onStatus('playing')
  }

  context.onstatechange = publishState

  return {
    start() {
      if (disposed) return Promise.resolve(false)
      wanted = true
      // Call resume within the pointer/key handler, before any await loses activation.
      const resumed = context.resume()
      publishState()
      return resumed.then(
        () => {
          publishState()
          return !disposed && wanted && context.state === 'running'
        },
        () => {
          publishState()
          return false
        },
      )
    },
    pause() {
      wanted = false
      publishState()
      void context.suspend().catch(publishState)
    },
    pant() {
      pant ??= createPant(context)
      pant.setVolume(petVolume)
      return pant.play()
    },
    stopPant() {
      pant?.stop()
    },
    skid(kind: SkidSound, intensity: number, length: SquealLength) {
      skidSqueal ??= createSkidSqueal(context)
      return skidSqueal.play(kind, intensity, length)
    },
    footstep(surface: GroundSurface, running: boolean) {
      footsteps ??= createFootsteps(context)
      return footsteps.play(surface, running)
    },
    /** Through the music's gain, so the ambient sound pauses with the music and keeps to its level. */
    setAmbience(scene: AmbientScene | null) {
      if (disposed) return
      ambience ??= createAmbience(context, master)
      ambience.update(scene)
    },
    speak(text: string, speaker: string) {
      dialogueVoice ??= createDialogueVoice(context, context.destination)
      dialogueVoice.setVolume(residentVolume)
      return dialogueVoice.play(text, speaker)
    },
    stopSpeaking() {
      dialogueVoice?.stop()
    },
    setVolume(nextVolume: number) {
      volume = clamp(nextVolume, 0, MAX_MUSIC_GAIN)
      master.gain.value = wanted ? volume : 0
    },
    setPetVolume(nextVolume: number) {
      petVolume = clamp(nextVolume, 0, 8)
      pant?.setVolume(petVolume)
    },
    setResidentVolume(nextVolume: number) {
      residentVolume = clamp(nextVolume, 0, 6)
      dialogueVoice?.setVolume(residentVolume)
    },
    setPeriod(next: DayPeriod) {
      if (period === next) return
      period = next
      beat = 0
    },
    dispose() {
      disposed = true
      pant?.dispose()
      dialogueVoice?.dispose()
      skidSqueal?.dispose()
      footsteps?.dispose()
      ambience?.dispose()
      clearInterval(timer)
      context.onstatechange = null
      void context.close().catch(() => undefined)
    },
  }
}
