import { describe, expect, it } from 'vitest'
import { BASEBALL_DIFFICULTIES } from '../../data/models'
import type { PracticeSample } from './calibration'
import { DIFFICULTY_RULES } from './difficulty'
import { type DerbyInputLog, type DerbyResult, replayDerby, type SwingEvent } from './derbyScore'
import { contactSeconds } from './pitch'
import { createRunPlan, planRunPitch } from './runPlan'

const plan = createRunPlan({ pitchCount: 5, difficulty: 'normal' }, 2026)
/** A webcam that registers swings about 110 ms late, which practice measures. */
const latency = 110
const practice: PracticeSample[] = [100, 120, 110, 130, 90].map((errorMs) => ({ errorMs, speed: 8 }))

/** A swing at pitch `pitchIndex` reaching the contact point `lateBy` ms after the ball, as the tracker reports it. */
function swing(
  pitchIndex: number,
  lateBy: number,
  heightError: number | null = 0,
  speed = 8,
  runPlan = plan,
): SwingEvent {
  const contactMs = contactSeconds(planRunPitch(runPlan, pitchIndex)) * 1000 + lateBy
  return { contactMs, startedMs: contactMs - 220, speed, heightError }
}

function cameraLog(swings: (SwingEvent | null)[], practiceSamples = practice): DerbyInputLog {
  return { side: 'right', practice: practiceSamples, swings }
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

  it('carries a PERFECT practice-peak swing out of the park on every difficulty, farther than a lost bat', () => {
    BASEBALL_DIFFICULTIES.forEach((difficulty) => {
      const difficultyPlan = createRunPlan({ pitchCount: 5, difficulty }, 2026)
      const windows = DIFFICULTY_RULES[difficulty].timingWindows
      const swings = [0, -0.5, 0.5, -0.9, 0.9].map((share, index) =>
        swing(index, latency + share * windows.perfect, 0, 8, difficultyPlan),
      )
      const result = replayDerby(difficultyPlan, cameraLog(swings))
      expect(result.pitches.map((pitch) => [pitch.timing, pitch.outcome])).toEqual(
        swings.map(() => ['perfect', 'homeRun']),
      )
      const lostBat = replayDerby(difficultyPlan, cameraLog(replaced(swings, 0, { ...swings[0], heightError: null })))
      expect(result.pitches[0].distanceDecimetres).toBeGreaterThan(lostBat.pitches[0].distanceDecimetres)
    })
  })

  it('carries a faster swing farther against the practice peak, up to the power cap', () => {
    const [slow, atPeak, fast, wild] = [5, 8, 9.2, 40].map(
      (speed) => replayDerby(plan, cameraLog([swing(0, latency, 0, speed), null, null, null, null])).pitches[0],
    )
    expect(slow.distanceDecimetres).toBeLessThan(atPeak.distanceDecimetres)
    expect(atPeak.distanceDecimetres).toBeLessThan(fast.distanceDecimetres)
    expect(wild.distanceDecimetres).toBe(fast.distanceDecimetres)
  })
})
