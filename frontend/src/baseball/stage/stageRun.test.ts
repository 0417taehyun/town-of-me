import { describe, expect, it } from 'vitest'
import type { BaseballDifficulty, Vec3 } from '../../data/models'
import { CALIBRATION_RULES } from '../game/calibration'
import { DERBY_PHASE_MS, LATE_SWING_MARGIN_MS, latestContactMs, RESULT_HOLD_MS } from '../game/derby'
import { replayDerby } from '../game/derbyScore'
import { DIFFICULTY_RULES } from '../game/difficulty'
import { BATTER_REACH, CONTACT_DEPTH } from '../game/field'
import { gameTime } from '../game/gameClock'
import { contactHeight, contactSeconds, type PitchPlan, pitchPosition, secondsAtDepth } from '../game/pitch'
import { createPracticePlan, createRunPlan, planRunPitch } from '../game/runPlan'
import { SWING_RULES } from '../vision/swingTracker'
import { CONTACT_DELAY_MS } from './actors/swingMotion'
import type { ShotKind } from './cameraShots'
import {
  advanceStageRun,
  createStageRun,
  cueStageSwing,
  directedShot,
  playStageFrame,
  type RealTimeSwing,
  type RealTimeSwingCue,
  setStageRunPaused,
  type StageEvent,
  type StageRun,
  type StageRunSetup,
  STAGE_TIMING,
  stageBallView,
  swingStageRun,
} from './stageRun'

const FRAME_MS = 1000 / 60
/** A swing reaches the stage this long after the moment it reports. */
const HANDLED_LATE_MS = 40
const difficulties: BaseballDifficulty[] = ['easy', 'normal', 'hard']

/** How the visitor swings at each pitch: ms off its contact moment, or null to let it go. */
type Swinging = (pitchIndex: number) => number | null
type Playback = { run: StageRun; realMs: number; pending: RealTimeSwing | null; events: StageEvent[] }
/** Looks at the run after each frame, with that frame's events; it may move the next frame's time. */
type Watch = (playback: Playback, frameEvents: StageEvent[]) => void

function runSetup(difficulty: BaseballDifficulty, pitchCount: number, seed: number): StageRunSetup {
  return { plan: createRunPlan({ pitchCount, difficulty }, seed), log: { side: 'right', practice: [] } }
}

function practiceSetup(): StageRunSetup {
  return {
    plan: createPracticePlan({ pitchCount: 5, difficulty: 'normal' }),
    log: { side: 'right', practice: [] },
    practice: true,
  }
}

/** A camera swing with the bat level with the ball at `contactAtRealMs`, as fast as an uncalibrated run's peak. */
function levelSwing(pitch: PitchPlan, contactAtRealMs: number): RealTimeSwing {
  const speed = CALIBRATION_RULES.peakFloor
  return { contactAtRealMs, startedAtRealMs: contactAtRealMs - 200, speed, batHeight: contactHeight(pitch) }
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
  return levelSwing(release.pitch, contactAtRealMs)
}

/** One 60 fps frame: a swing is handed in HANDLED_LATE_MS after it was made, then the run advances to now. */
function playFrame(playback: Playback, swinging: Swinging, watch: Watch, reducedMotion: boolean) {
  playback.realMs += FRAME_MS
  const { run, pending } = playback
  const frameEvents: StageEvent[] = []
  if (pending && playback.realMs >= pending.contactAtRealMs + HANDLED_LATE_MS) {
    frameEvents.push(...swingStageRun(run, pending, playback.realMs))
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

/**
 * A one-pitch run with a swing `fromLatestMs` off the latest contact that still touches the ball, handed in `lagMs`
 * after it: where the ball was drawn on each 60 fps frame before then, and the run and the ball's place on the frame
 * that takes the swing.
 */
function swingHandedInLate(difficulty: BaseballDifficulty, fromLatestMs: number, lagMs: number) {
  const run = createStageRun(runSetup(difficulty, 1, 7), 0)
  const release = advanceStageRun(run, DERBY_PHASE_MS.ready + DERBY_PHASE_MS.windup, false).at(-1)
  if (release?.type !== 'release') throw new Error('expected the release')
  // No hit-stop or slow motion has changed the clock yet, so game time is real time.
  const contactAtRealMs = release.releasedMs + latestContactMs(run.derby, release.pitch) + fromLatestMs
  const handedInAtMs = contactAtRealMs + lagMs
  const frames = Array.from(
    { length: Math.ceil((handedInAtMs - release.releasedMs) / FRAME_MS) },
    (_, frame) => release.releasedMs + frame * FRAME_MS,
  )
  const drawn = frames.map((realMs) => {
    advanceStageRun(run, realMs, false)
    return stageBallView(run, realMs, null).position
  })
  swingStageRun(run, levelSwing(release.pitch, contactAtRealMs), handedInAtMs)
  const events = advanceStageRun(run, handedInAtMs, false).map((event) => event.type)
  const nowMs = gameTime(run.clock, handedInAtMs)
  return { run, frames, drawn, events, nowMs, handedInAtMs, handedIn: stageBallView(run, nowMs, null).position }
}

/** `value` with every number in it rounded to a millionth, minus zero as zero. */
function toMillionths(value: unknown): unknown {
  return JSON.parse(JSON.stringify(value), (_key, raw) =>
    typeof raw === 'number' ? Math.round(raw * 1e6) / 1e6 + 0 : raw,
  )
}

/**
 * A one-pitch run swung at dead on and handed in 60 ms after its contact moment, the camera having cued its start 60
 * ms before that moment, expecting it then, when `cued`: where the ball was drawn on the frame before the stage takes
 * the swing and on the frame it does, and how many 60 fps frames after that the bat meets the ball.
 */
function deadOnHandedIn(cued: boolean) {
  const run = createStageRun(runSetup('normal', 1, 7), 0)
  const release = advanceStageRun(run, DERBY_PHASE_MS.ready + DERBY_PHASE_MS.windup, false).at(-1)
  if (release?.type !== 'release') throw new Error('expected the release')
  // No hit-stop or slow motion has changed the clock yet, so game time is real time.
  const contactAtRealMs = release.releasedMs + contactSeconds(release.pitch) * 1000
  const cues: RealTimeSwingCue[] = cued ? [{ kind: 'started', crossingAtRealMs: contactAtRealMs }] : []
  advanceStageRun(run, contactAtRealMs - 60, false)
  cues.forEach((cue) => cueStageSwing(run, cue, contactAtRealMs - 60))
  const takenAtMs = contactAtRealMs + 60
  advanceStageRun(run, takenAtMs - FRAME_MS, false)
  const before = stageBallView(run, takenAtMs - FRAME_MS, null).position
  swingStageRun(run, levelSwing(release.pitch, contactAtRealMs), takenAtMs)
  const taken = stageBallView(run, gameTime(run.clock, takenAtMs), null).position
  const { met, realMs } = untilContact(run, takenAtMs)
  return { met, before, taken, framesToContact: Math.round((realMs - takenAtMs) / FRAME_MS) }
}

/**
 * Plays 60 fps frames of `run` from `fromRealMs` until the bat meets the ball, for at most a second: whether it did,
 * the frame it did (real ms), the game time and the ball then, and how deep the ball was drawn on each frame before.
 */
function untilContact(run: StageRun, fromRealMs: number) {
  const drawnDepths: number[] = []
  let realMs = fromRealMs
  let met = false
  while (!met && realMs < fromRealMs + 1000) {
    drawnDepths.push(-stageBallView(run, gameTime(run.clock, realMs), null).position.z)
    realMs += FRAME_MS
    met = advanceStageRun(run, realMs, false).some((event) => event.type === 'contact')
  }
  const nowMs = gameTime(run.clock, realMs)
  return { met, realMs, nowMs, ball: stageBallView(run, nowMs, null).position, drawnDepths }
}

/** A camera's swing reaches the stage this long after the frame it was seen in was taken. */
const CAMERA_DELAY_MS = 90

/**
 * The latest a camera swing reaches the stage after its contact moment: the tracker confirms it up to its finish
 * window after the crossing, on the next frame of a 15 fps camera, and that frame takes up to 100 ms to be delivered,
 * tracked, and taken by the next drawn frame.
 */
const LATEST_CAMERA_REPORT_MS = SWING_RULES.finishWithinMs + 1000 / 15 + 100

type CameraPlayback = {
  run: StageRun
  realMs: number
  pending: RealTimeSwing | null
  above: (number | null)[]
  cueing: boolean
  cued: boolean
}

/**
 * One 60 fps frame as DerbyDirector plays it: the camera's cues and swing, seen CAMERA_DELAY_MS ago, then everything
 * due. Each pitch is swung at dead on, the bat `above[pitch]` m over the ball (null: tracking lost it). When `cueing`,
 * the camera also cues each swing's start 60 ms before it, expecting it 40 ms later than it comes, after a stray check.
 */
function playCameraFrame(playback: CameraPlayback) {
  playback.realMs += FRAME_MS
  const { run, pending } = playback
  const due = pending && playback.realMs >= pending.contactAtRealMs + CAMERA_DELAY_MS ? [pending] : []
  if (due.length > 0) playback.pending = null
  const cues = cuesFor(playback, pending)
  const release = playStageFrame(run, due, playback.realMs, false, cues).find((event) => event.type === 'release')
  if (release?.type !== 'release') return
  const above = playback.above[release.pitchIndex]
  const contactAtRealMs = realMomentOf(run, release.releasedMs + contactSeconds(release.pitch) * 1000)
  const batHeight = above === null ? null : contactHeight(release.pitch) + above
  playback.pending = { contactAtRealMs, startedAtRealMs: contactAtRealMs - 200, speed: 9, batHeight }
  playback.cued = false
}

/** The derby once a camera playback (CameraPlayback) of `setup` has played it through, its swings cued or not. */
function cameraDerby(setup: StageRunSetup, above: (number | null)[], cueing: boolean) {
  const playback: CameraPlayback = {
    run: createStageRun(setup, 1000),
    realMs: 1000,
    pending: null,
    above,
    cueing,
    cued: false,
  }
  while (playback.run.derby.phase !== 'finished' && playback.realMs < 120_000) playCameraFrame(playback)
  return playback.run.derby
}

/** The camera's cues this frame of `pending`, the swing on its way: a stray check, then its start, once. */
function cuesFor(playback: CameraPlayback, pending: RealTimeSwing | null): RealTimeSwingCue[] {
  if (!playback.cueing || !pending || playback.cued || playback.realMs < pending.contactAtRealMs - 60) return []
  playback.cued = true
  return [{ kind: 'checked' }, { kind: 'started', crossingAtRealMs: pending.contactAtRealMs + 40 }]
}

function distance(from: Vec3, to: Vec3) {
  return Math.hypot(to.x - from.x, to.y - from.y, to.z - from.z)
}

/**
 * A one-pitch run after a practice whose swings all registered `offsetMs` late (minus: early), swung `errorMs` off
 * PERFECT once the calibration takes that off: its result, where the ball in play starts, and the nearest the ball was
 * drawn to the mitt from the frame that takes the swing until the bat meets it.
 */
function calibratedMeeting(offsetMs: number, errorMs: number) {
  const practice = Array.from({ length: CALIBRATION_RULES.minimumValidSwings }, () => ({
    errorMs: offsetMs,
    speed: CALIBRATION_RULES.peakFloor,
  }))
  const setup: StageRunSetup = { ...runSetup('normal', 1, 7), log: { side: 'right', practice } }
  const drawnDepths: number[] = []
  let met = false
  const { run } = play(
    setup,
    () => offsetMs + errorMs,
    (playback, frameEvents) => {
      if (met || playback.run.derby.results.length === 0) return
      drawnDepths.push(-stageBallView(playback.run, gameTime(playback.run.clock, playback.realMs), null).position.z)
      met = frameEvents.some((event) => event.type === 'contact')
    },
  )
  return { result: run.derby.results[0], start: run.batted!.start, nearestDepth: Math.min(...drawnDepths) }
}

describe('stage run', () => {
  it('draws the bat meeting the ball when the judge times the swing, whichever way practice calibrated it', () => {
    // PERFECT from a visitor whose swings register late and from one who swings early, and the early one's late foul,
    // which the ball waits for at the back of the reach.
    const meetings = [calibratedMeeting(120, 0), calibratedMeeting(-120, 0), calibratedMeeting(-120, 100)]
    const meetDepths = [CONTACT_DEPTH, CONTACT_DEPTH, BATTER_REACH.back]
    expect(meetings.map(({ result }) => result.timing)).toEqual(['perfect', 'perfect', 'late'])
    meetings.forEach(({ start, nearestDepth }, index) => {
      expect(-start.z).toBeCloseTo(meetDepths[index], 6)
      expect(nearestDepth).toBeGreaterThanOrEqual(meetDepths[index] - 1e-9)
    })
  })

  it("draws each practice swing at the visitor's usual lag as a dead-on hit, the bat meeting the ball at the contact point", () => {
    const starts: Vec3[] = []
    const { run } = play(
      practiceSetup(),
      () => 150,
      (playback, frameEvents) => {
        if (frameEvents.some((event) => event.type === 'contact')) starts.push({ ...playback.run.batted!.start })
      },
    )
    expect(run.derby.results.map((result) => result.timing)).toEqual(run.derby.results.map(() => 'perfect'))
    expect(starts.map((start) => -start.z)).toEqual(run.derby.results.map(() => expect.closeTo(CONTACT_DEPTH, 6)))
  })

  it('keeps the first practice pitch at the back of the reach for a late swing reported late, which is on time', () => {
    const run = createStageRun(practiceSetup(), 0)
    const release = advanceStageRun(run, DERBY_PHASE_MS.ready + DERBY_PHASE_MS.windup, false).at(-1)
    if (release?.type !== 'release') throw new Error('expected the release')
    // No hit-stop or slow motion has changed the clock yet, so game time is real time. The camera has the bat at the
    // contact point 250 ms after the ball, the visitor's own timing as the first swing sets it, and reports it 300 ms on.
    const contactAtRealMs = release.releasedMs + contactSeconds(release.pitch) * 1000 + 250
    const handedInAtMs = contactAtRealMs + 300
    const frames = Array.from(
      { length: Math.ceil((handedInAtMs - release.releasedMs) / FRAME_MS) },
      (_, frame) => release.releasedMs + frame * FRAME_MS,
    )
    const drawnDepths = frames.map((realMs) => {
      advanceStageRun(run, realMs, false)
      return -stageBallView(run, realMs, null).position.z
    })
    swingStageRun(run, levelSwing(release.pitch, contactAtRealMs), handedInAtMs)
    const meeting = untilContact(run, handedInAtMs)
    expect([run.derby.results[0].timing, meeting.met]).toEqual(['perfect', true])
    expect(Math.min(...drawnDepths, ...meeting.drawnDepths)).toBeGreaterThanOrEqual(BATTER_REACH.back - 1e-9)
  })

  it('sends a ball in play from where the bat met it, early, on time, or late, even when the swing is handled late', () => {
    const offsetsMs = [0, -15, 20, 100]
    const starts: Vec3[] = []
    const { run } = play(
      runSetup('normal', 4, 7),
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
    const equalHomeRuns = play(runSetup('normal', 3, 7), () => 0, watch)
    expect(new Set(equalHomeRuns.run.derby.results.map((result) => result.distanceDecimetres)).size).toBe(1)
    expect(slowestRate).toEqual([STAGE_TIMING.apexSlowMotion.rate, 1, 1])
    expect(atSlowdown).toEqual([{ rising: false, landed: false }])
    expect(equalHomeRuns.run.clock.rate).toBe(1)
    slowestRate.length = 0
    play(runSetup('normal', 3, 7), () => 0, watch, true)
    expect(slowestRate).toEqual([1, 1, 1])
  })

  it('never lets the mitt catch a pitch a swing still in time then hits, and catches each one let go', () => {
    difficulties.forEach((difficulty) => {
      const lastMomentMs = DIFFICULTY_RULES[difficulty].timingWindows.contact - 5
      const late = play(runSetup(difficulty, 3, 7), () => lastMomentMs)
      expect(late.run.derby.results.map((result) => result.outcome)).toEqual(['foul', 'foul', 'foul'])
      expect(late.events.filter((event) => event.type === 'caught')).toEqual([])
      const letGo = play(runSetup(difficulty, 3, 7), () => null)
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

  it('keeps a pitch hit at the last moment at the back of the reach, however late a camera swing is reported', () => {
    difficulties.forEach((difficulty) => {
      const { drawn, run, handedInAtMs } = swingHandedInLate(difficulty, -5, LATE_SWING_MARGIN_MS - 10)
      const { met, drawnDepths } = untilContact(run, handedInAtMs)
      expect(met).toBe(true)
      const depths = [...drawn.map((position) => -position.z), ...drawnDepths]
      expect(Math.min(...depths)).toBeGreaterThanOrEqual(BATTER_REACH.back - 1e-9)
      expect(run.batted!.start).toEqual(drawn.at(-1))
    })
  })

  it('judges a camera swing that touched the ball however late the camera can report it, at every difficulty', () => {
    difficulties.forEach((difficulty) => {
      const { run } = swingHandedInLate(difficulty, -5, LATEST_CAMERA_REPORT_MS)
      const [swing] = run.derby.log.swings
      expect(swing?.contactMs).toBeCloseTo(latestContactMs(run.derby, run.pitch!.plan) - 5, 6)
      expect(run.derby.results[0].outcome).not.toBe('miss')
    })
  })

  it('sends a pitch a late swing missed on from where it waits, however late the swing is reported', () => {
    difficulties.forEach((difficulty) => {
      const { drawn, events, handedIn, run } = swingHandedInLate(difficulty, 5, 110)
      expect(events).not.toContain('contact')
      const frameTravel = distance(pitchPosition(run.pitch!.plan, 0), pitchPosition(run.pitch!.plan, FRAME_MS / 1000))
      expect(distance(drawn.at(-1)!, handedIn)).toBeLessThan(frameTravel)
    })
  })

  it('steps the clock back to give a hit handed in late the bat’s last stretch, then holds the bat on the ball', () => {
    const lagsMs = [FRAME_MS - 1, 115]
    lagsMs.forEach((lagMs) => {
      const { run, nowMs, handedInAtMs } = swingHandedInLate('normal', -60, lagMs)
      expect(nowMs).toBeCloseTo(run.batted!.meetMs - CONTACT_DELAY_MS, 9)
      const meeting = untilContact(run, handedInAtMs)
      expect(meeting.nowMs).toBe(run.batted!.meetMs)
      expect(meeting.ball).toEqual(run.batted!.start)
      expect(gameTime(run.clock, run.clock.realMs - 1)).toBe(run.batted!.meetMs)
      // On its way back into the bat, the ball is never drawn nearer the mitt than where they meet.
      expect(Math.min(...meeting.drawnDepths)).toBeGreaterThanOrEqual(-run.batted!.start.z - 1e-9)
    })
  })

  it('cues the chase on the frame the camera starts chasing each ball in play, after the hit-stop holds the bat on it', () => {
    const shotStartsMs: number[] = []
    const cuesMs: number[] = []
    const sinceContactMs: number[] = []
    let shot: ShotKind = 'batting'
    let contactMs = 0
    play(
      runSetup('normal', 3, 7),
      () => 0,
      ({ run, realMs }, frameEvents) => {
        const nowMs = gameTime(run.clock, realMs)
        const kind = directedShot(run, nowMs, 1, 'right', stageBallView(run, nowMs, null).position).kind
        if (shot === 'batting' && kind !== 'batting') shotStartsMs.push(realMs)
        shot = kind
        const types = frameEvents.map((event) => event.type)
        if (types.includes('contact')) contactMs = realMs
        if (!types.includes('chase')) return
        cuesMs.push(realMs)
        sinceContactMs.push(realMs - contactMs)
      },
    )
    expect(cuesMs).toHaveLength(3)
    expect(cuesMs).toEqual(shotStartsMs)
    sinceContactMs.forEach((ms) => expect(ms).toBeGreaterThan(STAGE_TIMING.hitStopMs))
  })

  it('meets a hit the camera saw begin a frame sooner after taking it, stepping the ball back less to meet it', () => {
    const [plain, cued] = [false, true].map(deadOnHandedIn)
    expect([plain.met, cued.met]).toEqual([true, true])
    expect(plain.framesToContact).toBe(Math.ceil(CONTACT_DELAY_MS / FRAME_MS))
    expect(cued.framesToContact).toBeLessThanOrEqual(2)
    expect(distance(cued.before, cued.taken)).toBeLessThan(distance(plain.before, plain.taken) - 0.2)
  })

  it('brings every ball in play down before its result ends, however high it was hit', () => {
    // Just past the GOOD edge a foul carries farthest, and hangs longest.
    const windowShares = [-0.95, -0.62, -0.5, 0, 0.5, 0.62, 0.95]
    const runs = difficulties.flatMap((difficulty) => [3, 7, 11].map((seed) => runSetup(difficulty, 7, seed)))
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
      runSetup('normal', 3, 7),
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
    const run = createStageRun(runSetup('normal', 3, 7), 0)
    advanceStageRun(run, 1000, false)
    setStageRunPaused(run, 1000, true)
    const hiddenEvents = advanceStageRun(run, 61_000, false)
    setStageRunPaused(run, 61_000, false)
    const shownEvents = advanceStageRun(run, 61_000 + DERBY_PHASE_MS.windup, false)
    expect(hiddenEvents).toEqual([])
    expect(shownEvents.map((event) => event.type)).toEqual(['release'])
  })

  it('begins the batter’s swing on a cue, ready as the judge would time its crossing, and checks it if it ends', () => {
    const practice = Array.from({ length: CALIBRATION_RULES.minimumValidSwings }, () => ({
      errorMs: 80,
      speed: CALIBRATION_RULES.peakFloor,
    }))
    const run = createStageRun({ ...runSetup('normal', 2, 7), log: { side: 'right', practice } }, 0)
    const { offsetMs } = run.derby.calibration
    expect(offsetMs).toBeGreaterThan(0)
    // Still in the windup, no pitch is on its way to swing at.
    advanceStageRun(run, DERBY_PHASE_MS.ready + 100, false)
    cueStageSwing(run, { kind: 'started', crossingAtRealMs: DERBY_PHASE_MS.ready + 400 }, DERBY_PHASE_MS.ready + 100)
    expect(run.shown).toBeNull()
    const releasedMs = DERBY_PHASE_MS.ready + DERBY_PHASE_MS.windup
    advanceStageRun(run, releasedMs, false)
    // The camera expects the crossing 400 ms on; the judge times this visitor's swings `offsetMs` sooner.
    cueStageSwing(run, { kind: 'started', crossingAtRealMs: releasedMs + 500 }, releasedMs + 100)
    expect(run.shown?.begun).toEqual({ startedMs: releasedMs + 100, readyMs: releasedMs + 500 - offsetMs })
    // A second start of the swing under way changes nothing; a check stops it, and a start after that begins anew, its
    // crossing due already, so the bat gets the least time it swings in.
    const begun = run.shown
    cueStageSwing(run, { kind: 'started', crossingAtRealMs: releasedMs + 600 }, releasedMs + 150)
    expect(run.shown).toBe(begun)
    cueStageSwing(run, { kind: 'checked' }, releasedMs + 200)
    expect(run.shown?.checkedMs).toBe(releasedMs + 200)
    cueStageSwing(run, { kind: 'started', crossingAtRealMs: releasedMs + 250 }, releasedMs + 250)
    expect(run.shown).toMatchObject({
      begun: { startedMs: releasedMs + 250, readyMs: releasedMs + 250 + CONTACT_DELAY_MS },
      checkedMs: null,
    })
    // The pitch goes by: the derby calls it without a swing, and the swing begun is checked.
    const events = advanceStageRun(run, releasedMs + 1600, false).map((event) => event.type)
    expect(events).toEqual(['result'])
    expect(run.shown?.checkedMs).toBe(releasedMs + 1600)
    // Judged, the pitch takes no other start.
    cueStageSwing(run, { kind: 'started', crossingAtRealMs: releasedMs + 1700 }, releasedMs + 1650)
    expect(run.shown?.checkedMs).toBe(releasedMs + 1600)
    expect(run.derby.log.swings).toEqual([null])
  })

  it('lets no cue of a swing begun or checked change what the derby judges, as a replay of its log shows', () => {
    const setup: StageRunSetup = {
      plan: createRunPlan({ pitchCount: 4, difficulty: 'normal' }, 9),
      log: { side: 'right', practice: [] },
    }
    const judged = [false, true].map((cueing) => cameraDerby(setup, [0, 0.2, null, 0.6], cueing))
    // A swing seen to begin steps the clock back less, so the same moments come out a rounding error apart, no more.
    expect(toMillionths(judged[1].log)).toEqual(toMillionths(judged[0].log))
    expect(toMillionths(judged[1].results)).toEqual(toMillionths(judged[0].results))
    expect(judged[1].results).toEqual(replayDerby(setup.plan, judged[1].log).pitches)
  })

  it('judges each camera swing at the moment its frame was taken, with its bat height, as a replay of its log does', () => {
    const above = [0, 0.2, null]
    const setup: StageRunSetup = {
      plan: createRunPlan({ pitchCount: above.length, difficulty: 'normal' }, 9),
      log: { side: 'right', practice: [] },
    }
    const derby = cameraDerby(setup, above, false)
    expect(derby.log.swings).not.toContain(null)
    derby.results.forEach((result) => expect(result.errorMs).toBeCloseTo(0, 6))
    const heights = derby.log.swings.map((swing) => swing?.heightError)
    expect(heights[0]).toBeCloseTo(0, 9)
    expect(heights[1]).toBeCloseTo(0.2, 9)
    expect(heights[2]).toBeNull()
    expect(derby.results).toEqual(replayDerby(setup.plan, derby.log).pitches)
  })
})
