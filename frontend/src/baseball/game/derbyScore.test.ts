import { describe, expect, it } from 'vitest'
import { BASEBALL_DIFFICULTIES } from '../../data/models'
import type { PracticeSample } from './calibration'
import { DIFFICULTY_RULES } from './difficulty'
import { type DerbyInputLog, type DerbyResult, replayDerby, type SwingEvent } from './derbyScore'
import { KEYBOARD_POWER } from './judging'
import { landingFor } from './landing'
import { contactSeconds } from './pitch'
import { createRunPlan, planRunPitch, type RunPlan } from './runPlan'

const plan = createRunPlan({ pitchCount: 5, difficulty: 'normal' }, 2026)
/** A webcam that registers swings about 110 ms late, which practice measures. */
const latency = 110
const practice: PracticeSample[] = [100, 120, 110, 130, 90].map((errorMs) => ({ errorMs, speed: 8 }))

/** A swing at pitch `pitchIndex` reaching the contact point `lateBy` ms after the ball, as the tracker reports it. */
function swing(pitchIndex: number, lateBy: number, heightError: number | null = 0, speed = 8): SwingEvent {
  const contactMs = contactSeconds(planRunPitch(plan, pitchIndex)) * 1000 + lateBy
  return { source: 'camera', contactMs, startedMs: contactMs - 220, speed, heightError }
}

/** A key pressed `lateBy` ms after the ball reaches the contact point, as the keyboard records it. */
function keyPress(runPlan: RunPlan, pitchIndex: number, lateBy: number): SwingEvent {
  const contactMs = contactSeconds(planRunPitch(runPlan, pitchIndex)) * 1000 + lateBy
  return { source: 'keyboard', contactMs, startedMs: contactMs, speed: 0, heightError: null }
}

function cameraLog(swings: (SwingEvent | null)[], practiceSamples = practice): DerbyInputLog {
  return { input: 'camera', side: 'right', practice: practiceSamples, swings }
}

function replaced(swings: (SwingEvent | null)[], pitchIndex: number, event: SwingEvent) {
  return swings.map((existing, index) => (index === pitchIndex ? event : existing))
}

function score(result: DerbyResult) {
  const { homeRuns, homeRunDistanceDecimetres, longestHomeRunDecimetres } = result
  return { homeRuns, homeRunDistanceDecimetres, longestHomeRunDecimetres }
}

describe('derby scoring', () => {
  it('scores the same plan and log the same way every time, in whole decimetres, without touching the log', () => {
    const log = cameraLog([swing(0, latency), swing(1, latency + 25), null, swing(3, latency - 120), swing(4, 400)])
    const before = structuredClone(log)
    const first = replayDerby(plan, log)
    expect(replayDerby(plan, log)).toEqual(first)
    expect(log).toEqual(before)
    expect(first.pitches).toHaveLength(plan.rules.pitchCount)
    first.pitches.forEach((pitch) => expect(Number.isInteger(pitch.distanceDecimetres)).toBe(true))
    expect(first.pitches.map((pitch) => pitch.pitchType)).toEqual(plan.schedule.map((pitch) => pitch.type))
  })

  it('takes a camera delay off every swing once practice has measured it', () => {
    const delayed = replayDerby(
      plan,
      cameraLog([0, 20, -30, 60, -80].map((lateBy, index) => swing(index, latency + lateBy))),
    )
    const prompt = replayDerby(
      plan,
      cameraLog(
        [0, 20, -30, 60, -80].map((lateBy, index) => swing(index, lateBy)),
        practice.map((sample) => ({ ...sample, errorMs: sample.errorMs - latency })),
      ),
    )
    expect(delayed.pitches.map((pitch) => pitch.outcome)).toEqual(prompt.pitches.map((pitch) => pitch.outcome))
    delayed.pitches.forEach((pitch, index) =>
      expect(pitch.distanceDecimetres).toBeCloseTo(prompt.pitches[index].distanceDecimetres, 0),
    )
    expect(delayed.homeRuns).toBeGreaterThan(0)
  })

  it('never scores a practice swing', () => {
    const result = replayDerby(plan, cameraLog([null, null, null, null, null]))
    expect(score(result)).toEqual({ homeRuns: 0, homeRunDistanceDecimetres: 0, longestHomeRunDecimetres: 0 })
    expect(new Set(result.pitches.map((pitch) => pitch.outcome))).toEqual(new Set(['miss']))
  })

  it('ranks a run by its home runs and their distance, however far its hits and fouls carry', () => {
    const swings = [swing(0, latency), swing(1, latency + 20), null, swing(3, latency, 0.4), null]
    const base = replayDerby(plan, cameraLog(swings))
    expect(base.pitches.map((pitch) => pitch.outcome)).toEqual(['homeRun', 'homeRun', 'miss', 'hit', 'miss'])
    expect(base.homeRunDistanceDecimetres).toBe(base.pitches[0].distanceDecimetres + base.pitches[1].distanceDecimetres)
    expect(base.longestHomeRunDecimetres).toBe(
      Math.max(base.pitches[0].distanceDecimetres, base.pitches[1].distanceDecimetres),
    )
    const longFoul = replayDerby(plan, cameraLog(replaced(swings, 2, swing(2, latency + 120, 0, 12))))
    expect(longFoul.pitches[2].outcome).toBe('foul')
    expect(longFoul.pitches[2].distanceDecimetres).toBeGreaterThan(base.pitches[3].distanceDecimetres)
    expect(score(longFoul)).toEqual(score(base))
    const another = replayDerby(plan, cameraLog(replaced(swings, 4, swing(4, latency - 10))))
    expect(another.homeRuns).toBe(base.homeRuns + 1)
    expect(another.homeRunDistanceDecimetres).toBe(
      base.homeRunDistanceDecimetres + another.pitches[4].distanceDecimetres,
    )
  })

  it('judges a keyboard run without whatever speed or bat height its swings claim', () => {
    const claimed = [0, 30, -60, 100, 15].map((lateBy, index) => swing(index, lateBy, 0.3, 40))
    const plain = claimed.map((event) => ({ ...event, speed: 0, heightError: null }))
    const keyboard = (swings: SwingEvent[]): DerbyInputLog => ({
      input: 'keyboard',
      side: 'right',
      practice: [],
      swings,
    })
    expect(replayDerby(plan, keyboard(claimed)).pitches).toEqual(replayDerby(plan, keyboard(plain)).pitches)
    expect(replayDerby(plan, cameraLog(claimed, [])).pitches).not.toEqual(replayDerby(plan, keyboard(claimed)).pitches)
  })

  it('carries a keyboard PERFECT out of the park on every difficulty, a dead-on one farther than a lost bat would', () => {
    BASEBALL_DIFFICULTIES.forEach((difficulty) => {
      const keyboardPlan = createRunPlan({ pitchCount: 5, difficulty }, 2026)
      const windows = DIFFICULTY_RULES[difficulty].timingWindows
      const swings = [0, -0.5, 0.5, -0.9, 0.9].map((share, index) =>
        keyPress(keyboardPlan, index, share * windows.perfect),
      )
      const result = replayDerby(keyboardPlan, { input: 'keyboard', side: 'right', practice: [], swings })
      expect(result.pitches.map((pitch) => [pitch.timing, pitch.outcome])).toEqual(
        swings.map(() => ['perfect', 'homeRun']),
      )
      const lostBat = landingFor({ errorMs: 0, power: KEYBOARD_POWER, heightError: null }, windows, 'right')
      expect(result.pitches[0].distanceDecimetres).toBeGreaterThan(lostBat.distanceDecimetres)
    })
  })

  it('judges a key pressed during a camera run as a keyboard swing and takes the run off the board', () => {
    const fast = swing(1, latency + 20, 0.3, 40)
    const swings = [swing(0, latency), fast, null, null, null]
    const camera = replayDerby(plan, cameraLog(swings))
    expect(camera.input).toBe('camera')
    const keyed = replayDerby(plan, cameraLog(replaced(swings, 1, { ...fast, source: 'keyboard' })))
    const plain = replayDerby(
      plan,
      cameraLog(replaced(swings, 1, { ...fast, source: 'keyboard', speed: 0, heightError: null })),
    )
    expect(keyed.input).toBe('keyboard')
    expect(keyed.pitches[1]).toEqual(plain.pitches[1])
    expect(keyed.pitches[1].power).toBe(KEYBOARD_POWER)
    expect(keyed.pitches[1]).not.toEqual(camera.pitches[1])
    expect(keyed.pitches[0]).toEqual(camera.pitches[0])
  })
})
