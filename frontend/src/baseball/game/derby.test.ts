import { describe, expect, it } from 'vitest'
import { PITCH_COUNT_RANGE } from '../../data/models'
import type { PracticeSample } from './calibration'
import { DIFFICULTY_RULES } from './difficulty'
import {
  advanceDerby,
  createDerby,
  DERBY_PHASE_MS,
  type Derby,
  type DerbyEvent,
  type DerbySwing,
  phaseEndMs,
  swingDerby,
} from './derby'
import { type DerbyInputLog, replayDerby } from './derbyScore'
import { contactHeight, contactSeconds } from './pitch'
import { createRunPlan, planRunPitch } from './runPlan'

/** A run with no practice before it, so nothing calibrates it. */
const uncalibrated: Omit<DerbyInputLog, 'swings'> = { side: 'right', practice: [] }
/** Practice that measured a webcam registering swings about 110 ms late. */
const latency = 110
const practice: PracticeSample[] = [100, 120, 110, 130, 90].map((errorMs) => ({ errorMs, speed: 8 }))
const counts = Array.from(
  { length: PITCH_COUNT_RANGE.maximum - PITCH_COUNT_RANGE.minimum + 1 },
  (_, index) => PITCH_COUNT_RANGE.minimum + index,
)

/** Plays the derby with nobody swinging, one advance per `frameMs`, until it finishes. */
function events(derby: Derby, frameMs: number) {
  const seen: DerbyEvent[] = []
  let current = derby
  for (let nowMs = 0; current.phase !== 'finished' && nowMs < 600000; nowMs += frameMs) {
    const update = advanceDerby(current, nowMs)
    current = update.derby
    seen.push(...update.events)
  }
  return { derby: current, seen }
}

/** Brings the derby to its next release, phase by phase. */
function toRelease(derby: Derby) {
  let current = derby
  while (current.phase !== 'pitch') current = advanceDerby(current, phaseEndMs(current) ?? Infinity).derby
  return current
}

/** When the bat would reach the current pitch's contact point `lateBy` ms after the ball, on the game clock. */
function contactAt(pitching: Derby, lateBy: number) {
  return pitching.phaseStartedMs + contactSeconds(planRunPitch(pitching.plan, pitching.pitchIndex)) * 1000 + lateBy
}

/** A camera swing with its bat `batHeight` m up; by default level with the middle of the strike zone. */
function swingAt(contactAtMs: number, batHeight: number | null = 0.6, speed = 8): DerbySwing {
  return { contactAtMs, startedAtMs: contactAtMs - 220, speed, batHeight }
}

/** A swing at the pitch on its way `lateBy` ms after the ball reaches the contact point, `above` m over the ball. */
function swingAtBall(pitching: Derby, lateBy: number, above: number | null = 0) {
  const ballHeight = contactHeight(planRunPitch(pitching.plan, pitching.pitchIndex))
  return swingAt(contactAt(pitching, lateBy), above === null ? null : ballHeight + above)
}

/** Plays the next pitch: a swing `lateBy` ms after the ball reaches the contact point, `above` m over it, or none. */
function playPitch(derby: Derby, lateBy: number | null, above: number | null = 0) {
  const pitching = toRelease(derby)
  if (lateBy === null) return advanceDerby(pitching, phaseEndMs(pitching) ?? Infinity)
  return swingDerby(pitching, swingAtBall(pitching, lateBy, above))
}

/** Plays each pitch of `derby` with a swing `lateBy` ms late and `above` m over the ball (null `lateBy` lets it go). */
function playRun(derby: Derby, swings: readonly { lateBy: number | null; above?: number | null }[]) {
  return swings.reduce<{ derby: Derby; events: DerbyEvent[] }>(
    (played, { lateBy, above }) => {
      const update = playPitch(played.derby, lateBy, above)
      return { derby: update.derby, events: [...played.events, ...update.events] }
    },
    { derby, events: [] },
  )
}

describe('derby', () => {
  it('ends a run of N pitches after exactly N results, the same at any frame rate', () => {
    counts.forEach((pitchCount) => {
      const derby = createDerby(createRunPlan({ pitchCount, difficulty: 'hard' }, pitchCount), uncalibrated, 0)
      const played = events(derby, 1000 / 60)
      const types = played.seen.map((event) => event.type)
      expect(types.filter((type) => type === 'result')).toHaveLength(pitchCount)
      expect(types.filter((type) => type === 'release')).toHaveLength(pitchCount)
      expect(types.at(-1)).toBe('finished')
      expect(types.filter((type) => type === 'finished')).toHaveLength(1)
      expect(played.derby.results).toHaveLength(pitchCount)
      expect(events(derby, 1000 / 23).seen).toEqual(played.seen)
      expect(advanceDerby(played.derby, 10 ** 9).events).toEqual([])
    })
  })

  it('ignores a swing during the windup, one before the release, and a second swing at the same pitch', () => {
    const plan = createRunPlan({ pitchCount: 3, difficulty: 'normal' }, 11)
    const winding = advanceDerby(createDerby(plan, uncalibrated, 0), DERBY_PHASE_MS.ready + 100).derby
    expect(winding.phase).toBe('windup')
    const duringWindup = swingDerby(winding, swingAt(DERBY_PHASE_MS.ready + 200))
    expect(duringWindup.derby.phase).toBe('windup')
    expect(duringWindup.events).toEqual([])
    const pitching = toRelease(duringWindup.derby)
    expect(swingDerby(pitching, swingAt(pitching.phaseStartedMs - 30)).events).toEqual([])
    const swung = swingDerby(pitching, swingAtBall(pitching, 0))
    expect(swung.events.map((event) => event.type)).toEqual(['result'])
    expect(swung.derby.results[0].outcome).toBe('homeRun')
    expect(swingDerby(swung.derby, swingAt(contactAt(pitching, 30))).derby).toEqual(swung.derby)
  })

  it('ignores a swing or a moment that is not a number instead of playing out the run', () => {
    const plan = createRunPlan({ pitchCount: 5, difficulty: 'normal' }, 14)
    const pitching = toRelease(createDerby(plan, uncalibrated, 0))
    const glitches = [NaN, Infinity].flatMap((value) => [
      { ...swingAt(value) },
      { ...swingAt(contactAt(pitching, 0)), speed: value },
      { ...swingAt(contactAt(pitching, 0)), batHeight: value },
    ])
    glitches.forEach((glitch) => expect(swingDerby(pitching, glitch)).toEqual({ derby: pitching, events: [] }))
    expect(advanceDerby(pitching, NaN)).toEqual({ derby: pitching, events: [] })
  })

  it('meets a swing reported a frame after the release with the pitch it was aimed at', () => {
    const plan = createRunPlan({ pitchCount: 3, difficulty: 'normal' }, 12)
    const releasedMs = DERBY_PHASE_MS.ready + DERBY_PHASE_MS.windup
    const winding = advanceDerby(createDerby(plan, uncalibrated, 0), releasedMs - 5).derby
    const contactAtMs = releasedMs + contactSeconds(planRunPitch(plan, 0)) * 1000
    const swung = swingDerby(winding, swingAt(contactAtMs))
    expect(swung.events.map((event) => event.type)).toEqual(['release', 'result'])
    expect(swung.derby.results[0].timing).toBe('perfect')
  })

  it('takes the latest swing that still touches the ball after a camera delay, and none once the pitch is over', () => {
    const plan = createRunPlan({ pitchCount: 3, difficulty: 'normal' }, 13)
    const pitching = toRelease(createDerby(plan, { side: 'left', practice }, 0))
    const latest = latency + DIFFICULTY_RULES.normal.timingWindows.contact - 1
    expect(swingDerby(pitching, swingAt(contactAt(pitching, latest))).derby.results[0].outcome).toBe('foul')
    const over = advanceDerby(pitching, phaseEndMs(pitching) ?? Infinity)
    expect(over.derby.results[0]).toMatchObject({ outcome: 'miss', timing: null })
    expect(over.derby.phaseStartedMs).toBeGreaterThan(contactAt(pitching, latest))
    expect(swingDerby(over.derby, swingAt((phaseEndMs(pitching) ?? 0) + 1)).derby).toEqual(over.derby)
  })

  it('shows live the same results a replay of its log gives, timing each swing from its own release', () => {
    const plan = createRunPlan({ pitchCount: 6, difficulty: 'normal' }, 2026)
    const lateness = [latency, latency + 30, null, latency - 120, latency + 200, latency - 20]
    const derby = playRun(
      createDerby(plan, { side: 'right', practice }, 0),
      lateness.map((lateBy) => ({ lateBy })),
    )
    const finished = advanceDerby(derby.derby, 10 ** 9)
    const replayed = replayDerby(plan, finished.derby.log)
    expect(finished.derby.results).toEqual(replayed.pitches)
    expect(finished.events).toEqual([{ type: 'finished', result: replayed }])
    expect(replayed.pitches.map((pitch) => pitch.outcome)).toEqual([
      'homeRun',
      'homeRun',
      'miss',
      'foul',
      'miss',
      'homeRun',
    ])
    const recorded = finished.derby.log.swings.map((swing) => swing?.contactMs ?? null)
    const aimed = lateness.map((lateBy, index) =>
      lateBy === null ? null : contactSeconds(planRunPitch(plan, index)) * 1000 + lateBy,
    )
    expect(recorded.map((contactMs) => contactMs === null)).toEqual(aimed.map((contactMs) => contactMs === null))
    recorded.forEach((contactMs, index) => expect(contactMs ?? 0).toBeCloseTo(aimed[index] ?? 0, 6))
  })

  it('logs a camera swing’s bat height against the ball at the contact point, judged live as a replay judges it', () => {
    const plan = createRunPlan({ pitchCount: 4, difficulty: 'normal' }, 2027)
    const measured = [0, 0.3, -0.6]
    const played = playRun(
      createDerby(plan, { side: 'right', practice }, 0),
      [...measured, null].map((above) => ({ lateBy: latency, above })),
    )
    const finished = advanceDerby(played.derby, 10 ** 9)
    const logged = finished.derby.log.swings.map((swing) => swing?.heightError)
    measured.forEach((above, index) => expect(logged[index]).toBeCloseTo(above, 9))
    expect(logged[3]).toBeNull()
    expect(finished.derby.results).toEqual(replayDerby(plan, finished.derby.log).pitches)
    // On time, a bat level with the ball goes farthest; one far under it misses, while a lost bat still connects.
    const [level, over, under, lost] = finished.derby.results
    expect(level.distanceDecimetres).toBeGreaterThan(over.distanceDecimetres)
    expect(under.outcome).toBe('miss')
    expect(lost.outcome).not.toBe('miss')
    expect(lost.distanceDecimetres).toBeLessThan(level.distanceDecimetres)
  })
})
