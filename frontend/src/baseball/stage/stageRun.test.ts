import { describe, expect, it } from 'vitest'
import type { BaseballDifficulty, Vec3 } from '../../data/models'
import { DERBY_PHASE_MS, RESULT_HOLD_MS } from '../game/derby'
import { DIFFICULTY_RULES } from '../game/difficulty'
import { BATTER_REACH } from '../game/field'
import { contactSeconds, pitchPosition, secondsAtDepth } from '../game/pitch'
import { createRunPlan, planRunPitch } from '../game/runPlan'
import {
  advanceStageRun,
  createStageRun,
  type RealTimeSwing,
  setStageRunPaused,
  type StageEvent,
  type StageRun,
  type StageRunSetup,
  STAGE_TIMING,
  swingStageRun,
} from './stageRun'

const FRAME_MS = 1000 / 60
/** Input reaches the stage this long after the swing it reports. */
const HANDLED_LATE_MS = 40
const difficulties: BaseballDifficulty[] = ['easy', 'normal', 'hard']

/** How the visitor swings at each pitch: ms off its contact moment, or null to let it go. */
type Swinging = (pitchIndex: number) => number | null
type Playback = { run: StageRun; realMs: number; pending: RealTimeSwing | null; events: StageEvent[] }
/** Looks at the run after each frame, with that frame's events; it may move the next frame's time. */
type Watch = (playback: Playback, frameEvents: StageEvent[]) => void

function keyboardSetup(difficulty: BaseballDifficulty, pitchCount: number, seed: number): StageRunSetup {
  return {
    plan: createRunPlan({ pitchCount, difficulty }, seed),
    log: { input: 'keyboard', side: 'right', practice: [] },
  }
}

/** The real moment game time reaches `gameMs`, while the clock keeps its current pace. */
function realMomentOf(run: StageRun, gameMs: number) {
  return run.clock.realMs + (gameMs - run.clock.gameMs) / run.clock.rate
}

/** The swing at a pitch released this frame, `swinging` ms off its contact moment, or null when it is let go. */
function swingAt(run: StageRun, frameEvents: StageEvent[], swinging: Swinging): RealTimeSwing | null {
  const release = frameEvents.find((event) => event.type === 'release')
  if (release?.type !== 'release') return null
  const offsetMs = swinging(release.pitchIndex)
  if (offsetMs === null) return null
  const contactAtRealMs = realMomentOf(run, release.releasedMs + contactSeconds(release.pitch) * 1000 + offsetMs)
  return { source: 'keyboard', contactAtRealMs, startedAtRealMs: contactAtRealMs, speed: 0, heightError: null }
}

/** One 60 fps frame: a swing is handed in HANDLED_LATE_MS after it was made, then the run advances to now. */
function playFrame(playback: Playback, swinging: Swinging, watch: Watch, reducedMotion: boolean) {
  playback.realMs += FRAME_MS
  const { run, pending } = playback
  const frameEvents: StageEvent[] = []
  if (pending && playback.realMs >= pending.contactAtRealMs + HANDLED_LATE_MS) {
    frameEvents.push(...swingStageRun(run, pending))
    playback.pending = null
  }
  frameEvents.push(...advanceStageRun(run, playback.realMs, reducedMotion))
  playback.events.push(...frameEvents)
  playback.pending = playback.pending ?? swingAt(run, frameEvents, swinging)
  watch(playback, frameEvents)
}

function play(setup: StageRunSetup, swinging: Swinging, watch: Watch = () => undefined, reducedMotion = false) {
  const playback: Playback = { run: createStageRun(setup, 1000), realMs: 1000, pending: null, events: [] }
  while (playback.run.derby.phase !== 'finished' && playback.realMs < 600_000)
    playFrame(playback, swinging, watch, reducedMotion)
  return playback
}

describe('stage run', () => {
  it('sends a ball in play from where the bat met it, early, on time, or late, even when the swing is handled late', () => {
    const offsetsMs = [0, -15, 20, 100]
    const starts: Vec3[] = []
    const { run } = play(
      keyboardSetup('normal', 4, 7),
      (pitchIndex) => offsetsMs[pitchIndex],
      (playback, frameEvents) => {
        if (frameEvents.some((event) => event.type === 'contact')) starts.push({ ...playback.run.batted!.start })
      },
    )
    // Where the pitch was when the swing got there; a late swing finds it waiting at the back of the reach.
    const expected = offsetsMs.map((offsetMs, pitchIndex) => {
      const pitch = planRunPitch(run.derby.plan, pitchIndex)
      const seconds = Math.min(contactSeconds(pitch) + offsetMs / 1000, secondsAtDepth(pitch, BATTER_REACH.back))
      return pitchPosition(pitch, seconds)
    })
    expect(run.derby.results.map((result) => result.outcome)).not.toContain('miss')
    expect(starts).toHaveLength(offsetsMs.length)
    starts.forEach((start, pitchIndex) => {
      expect(start.x).toBeCloseTo(expected[pitchIndex].x, 3)
      expect(start.y).toBeCloseTo(expected[pitchIndex].y, 3)
      expect(start.z).toBeCloseTo(expected[pitchIndex].z, 3)
    })
  })

  it("slows the clock only past the peak of the run's showcase home run, in the air, then returns to full speed", () => {
    const slowestRate: number[] = []
    const atSlowdown: Array<{ rising: boolean; landed: boolean }> = []
    const watch: Watch = ({ run }) => {
      const flight = run.batted?.flight
      slowestRate[run.derby.pitchIndex] = Math.min(slowestRate[run.derby.pitchIndex] ?? 1, run.clock.rate)
      if (flight && run.clock.rate < 1 && atSlowdown.length === 0)
        atSlowdown.push({ rising: flight.velocity.y > 0, landed: flight.landed })
    }
    const equalHomeRuns = play(keyboardSetup('normal', 3, 7), () => 0, watch)
    expect(new Set(equalHomeRuns.run.derby.results.map((result) => result.distanceDecimetres)).size).toBe(1)
    expect(slowestRate).toEqual([STAGE_TIMING.apexSlowMotion.rate, 1, 1])
    expect(atSlowdown).toEqual([{ rising: false, landed: false }])
    expect(equalHomeRuns.run.clock.rate).toBe(1)
    slowestRate.length = 0
    play(keyboardSetup('normal', 3, 7), () => 0, watch, true)
    expect(slowestRate).toEqual([1, 1, 1])
  })

  it('never lets the mitt catch a pitch a swing still in time then hits, and catches each one let go', () => {
    difficulties.forEach((difficulty) => {
      const lastMomentMs = DIFFICULTY_RULES[difficulty].timingWindows.contact - 5
      const late = play(keyboardSetup(difficulty, 3, 7), () => lastMomentMs)
      expect(late.run.derby.results.map((result) => result.outcome)).toEqual(['foul', 'foul', 'foul'])
      expect(late.events.filter((event) => event.type === 'caught')).toEqual([])
      const letGo = play(keyboardSetup(difficulty, 3, 7), () => null)
      const judgedAndCaught = letGo.events.filter((event) => event.type === 'result' || event.type === 'caught')
      expect(judgedAndCaught.map((event) => event.type)).toEqual([
        'result',
        'caught',
        'result',
        'caught',
        'result',
        'caught',
      ])
    })
  })

  it('brings every ball in play down before its result ends, however high it was hit', () => {
    // Just past the GOOD edge a foul carries farthest, and hangs longest.
    const windowShares = [-0.95, -0.62, -0.5, 0, 0.5, 0.62, 0.95]
    const runs = difficulties.flatMap((difficulty) => [3, 7, 11].map((seed) => keyboardSetup(difficulty, 7, seed)))
    const flyingAfterResults = runs.map((setup) => {
      const contactWindowMs = DIFFICULTY_RULES[setup.plan.rules.difficulty].timingWindows.contact
      let flying = 0
      play(
        setup,
        (pitchIndex) => windowShares[pitchIndex] * contactWindowMs,
        ({ run }) => {
          const between = run.derby.phase !== 'pitch' && run.derby.phase !== 'result'
          flying += Number(between && run.batted?.flight?.landed === false)
        },
      )
      return flying
    })
    expect(flyingAfterResults).toEqual(runs.map(() => 0))
  })

  it('keeps every pitch at full speed when a stalled frame steps a showcase home run past its peak', () => {
    let stalled = false
    let slowestPitchRate = 1
    play(
      keyboardSetup('normal', 3, 7),
      () => 0,
      (playback, frameEvents) => {
        const { run } = playback
        if (run.derby.phase === 'pitch') slowestPitchRate = Math.min(slowestPitchRate, run.clock.rate)
        if (stalled || !frameEvents.some((event) => event.type === 'contact')) return
        stalled = true
        // The next frame comes late in the next windup, so the home run is stepped past its peak only there.
        const { ready, windup } = DERBY_PHASE_MS
        const lateInWindupMs = run.derby.phaseStartedMs + RESULT_HOLD_MS.homeRun + ready + windup - 150
        playback.realMs = realMomentOf(run, lateInWindupMs) - FRAME_MS
      },
    )
    expect(stalled).toBe(true)
    expect(slowestPitchRate).toBe(1)
  })

  it('lets no pitch go by while the page is hidden', () => {
    const run = createStageRun(keyboardSetup('normal', 3, 7), 0)
    advanceStageRun(run, 1000, false)
    setStageRunPaused(run, 1000, true)
    const hiddenEvents = advanceStageRun(run, 61_000, false)
    setStageRunPaused(run, 61_000, false)
    const shownEvents = advanceStageRun(run, 61_000 + DERBY_PHASE_MS.windup, false)
    expect(hiddenEvents).toEqual([])
    expect(shownEvents.map((event) => event.type)).toEqual(['release'])
  })
})
