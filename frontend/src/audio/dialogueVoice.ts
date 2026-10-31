import { clamp } from '../motionMath'

export type DialogueNote = { start: number; duration: number; frequency: number }

const DIALOGUE_TIME_SCALE = 0.88

export function namePitch(name: string) {
  const hash = Array.from(name).reduce((total, character) => (total * 31 + (character.codePointAt(0) ?? 0)) % 9973, 7)
  return 188 + (hash % 7) * 7
}

/** Only the start of a long line is voiced, so a long answer does not keep chattering. */
const VOICED_CHARACTER_LIMIT = 72

/** Spaces and punctuation are silent pauses; every other character is one syllable followed by a short gap. */
export function characterTiming(character: string) {
  if (/\s/u.test(character)) return { duration: 0, advance: 0.036 * DIALOGUE_TIME_SCALE }
  if (/[,;]/u.test(character)) return { duration: 0, advance: 0.078 * DIALOGUE_TIME_SCALE }
  if (/[.!?]/u.test(character)) return { duration: 0, advance: 0.12 * DIALOGUE_TIME_SCALE }
  const code = character.codePointAt(0) ?? 0
  const duration = (0.043 + (code % 4) * 0.0055) * DIALOGUE_TIME_SCALE
  return { duration, advance: duration + (0.008 + (code % 3) * 0.0025) * DIALOGUE_TIME_SCALE }
}

export function voicedTimeline(text: string) {
  const characters = Array.from(text).slice(0, VOICED_CHARACTER_LIMIT)
  let cursor = 0
  const starts = characters.map((character) => {
    const start = cursor
    cursor += characterTiming(character).advance
    return start
  })
  return { characters, starts, end: cursor }
}

export function createDialogueNotes(text: string, speaker: string): DialogueNote[] {
  const base = namePitch(speaker)
  const { characters, starts } = voicedTimeline(text)
  return characters
    .map((character, index) => ({ character, index, duration: characterTiming(character).duration }))
    .filter(({ duration }) => duration > 0)
    .map(({ character, index, duration }) => ({
      start: starts[index],
      duration,
      frequency: base + pitchContour(character, index),
    }))
}

/** Each syllable lifts or drops a little from the speaker's pitch, so a line has a tune rather than a drone. */
export function pitchContour(character: string, index: number) {
  const code = character.codePointAt(0) ?? 0
  return ((code % 5) - 2) * 4 + Math.sin(index * 1.4) * 6
}

/** Seconds after the voice starts at which each character of the line appears, in step with its syllable blips. */
export function getRevealTimes(text: string) {
  const { characters, starts, end } = voicedTimeline(text)
  const averageSpacing = end / Math.max(1, characters.length)
  const unvoicedStarts = Array.from(text)
    .slice(VOICED_CHARACTER_LIMIT)
    .map((_, index) => end + index * averageSpacing)
  return [...starts, ...unvoicedStarts]
}

export function createDialogueVoice(context: AudioContext, destination: AudioNode) {
  const filter = context.createBiquadFilter()
  const master = context.createGain()
  filter.type = 'lowpass'
  filter.frequency.value = 1800
  filter.Q.value = 0.55
  master.gain.value = 0.16
  filter.connect(master).connect(destination)
  const oscillators = new Set<OscillatorNode>()
  let disposed = false

  function stop() {
    oscillators.forEach((oscillator) => {
      oscillator.onended = null
      oscillator.stop()
      oscillator.disconnect()
    })
    oscillators.clear()
  }

  return {
    async play(text: string, speaker: string) {
      if (disposed) return false
      stop()
      try {
        await context.resume()
      } catch {
        return false
      }
      if (disposed || context.state !== 'running') return false
      const start = context.currentTime + 0.015
      createDialogueNotes(text, speaker).forEach((note) => {
        const oscillator = context.createOscillator()
        const envelope = context.createGain()
        oscillator.type = 'triangle'
        oscillator.frequency.setValueAtTime(note.frequency, start + note.start)
        oscillator.frequency.exponentialRampToValueAtTime(note.frequency * 0.985, start + note.start + note.duration)
        envelope.gain.setValueAtTime(0.0001, start + note.start)
        envelope.gain.exponentialRampToValueAtTime(0.115, start + note.start + 0.009 * DIALOGUE_TIME_SCALE)
        envelope.gain.exponentialRampToValueAtTime(0.0001, start + note.start + note.duration)
        oscillator.connect(envelope).connect(filter)
        oscillators.add(oscillator)
        oscillator.onended = () => {
          oscillator.disconnect()
          envelope.disconnect()
          oscillators.delete(oscillator)
        }
        oscillator.start(start + note.start)
        oscillator.stop(start + note.start + note.duration + 0.01)
      })
      return oscillators.size > 0
    },
    setVolume(nextVolume: number) {
      master.gain.value = 0.16 * clamp(nextVolume, 0, 6)
    },
    stop,
    dispose() {
      disposed = true
      stop()
      filter.disconnect()
      master.disconnect()
    },
  }
}
