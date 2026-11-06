import { describe, expect, it } from 'vitest'
import { type BallparkSettings, type BaseballDifficulty, DEFAULT_TOWN_VENUES } from '../../data/models'
import type { CameraStatus } from '../cameraTracking'
import { createDerby, type DerbyPhase, LATE_SWING_MARGIN_MS } from '../game/derby'
import { DIFFICULTY_RULES, PRACTICE_PITCH_FLIGHT_SECONDS } from '../game/difficulty'
import { contactHeight, contactSeconds, PITCH_TYPES } from '../game/pitch'
import { PRACTICE_SCHEDULE } from '../game/pitchSchedule'
import {
  createStageRun,
  playStageFrame,
  type RealTimeSwing,
  setStageRunPaused,
  type StageEvent,
  type StageRun,
  type StageRunSetup,
} from '../stage/stageRun'
import { betweenPitches, type DerbyHudState, hudAfterEvent, judgedResult, NEW_RUN_HUD } from '../ui/derbyCues'
import { AWAY_HOLD_MS, nextSight, type Sight, UNSEEN } from '../vision/poseLoop'
import {
  createDerbyRun,
  createMorePracticeRun,
  createPracticeRun,
  type DerbyFlow,
  type DerbyPlays,
  type DerbyStep,
  derbyStep,
  flowAfterEvent,
  offersMorePractice,
  pausedForAway,
  practiceFeedback,
  practiceResultSample,
  runFlow,
  setupFlow,
  shownPracticeFeedback,
  shownRun,
  stanceWait,
  startedFlow,
  startsRun,
} from './derbyFlow'

const FRAME_MS = 1000 / 60
/** A camera swing reaches the page this long after the bat crossed the body. */
const SEEN_LATE_MS = 120
const ballpark: BallparkSettings = { ...DEFAULT_TOWN_VENUES.ballpark, rules: { pitchCount: 5, difficulty: 'normal' } }
const hardBallpark: BallparkSettings = { ...ballpark, rules: { pitchCount: 5, difficulty: 'hard' } }
const october = new Date('2026-10-20T03:00:00Z')
const plays: DerbyPlays = {
  practice: () => createPracticeRun(ballpark, october, 'left'),
  morePractice: (practice) => createMorePracticeRun(ballpark, october, 'left', practice),
  run: (practice) => createDerbyRun(ballpark, october, 7, { side: 'left', practice }),
}
const steps: DerbyStep[] = ['rules', 'setup', 'practice', 'practiceDone', 'play', 'result']
const cameraKinds: CameraStatus['kind'][] = ['off', 'starting', 'loading', 'measuring', 'ready', 'problem']

type Playback = { run: StageRun; events: StageEvent[]; coming: RealTimeSwing[]; seenLateMs: number }

/** The real moment game time reaches `gameMs`, while the clock keeps its current pace. */
function realMomentOf(run: StageRun, gameMs: number) {
  return run.clock.realMs + (gameMs - run.clock.gameMs) / run.clock.rate
}

/** The camera swing at a pitch just released, `offsetsMs[i]` ms after the ball reaches the contact point, if any. */
function swingAtRelease(run: StageRun, event: StageEvent, offsetsMs: readonly (number | null)[]): RealTimeSwing[] {
  const offsetMs = event.type === 'release' ? offsetsMs[event.pitchIndex] : null
  if (event.type !== 'release' || offsetMs === null || offsetMs === undefined) return []
  const contactAtRealMs = realMomentOf(run, event.releasedMs + contactSeconds(event.pitch) * 1000 + offsetMs)
  const batHeight = contactHeight(event.pitch)
  return [{ contactAtRealMs, startedAtRealMs: contactAtRealMs - 200, speed: 8, batHeight }]
}

/** One 60 fps frame: the swings seen by now reach the stage, which then plays everything due. */
function stageFrame(playback: Playback, realMs: number, offsetsMs: readonly (number | null)[]) {
  const seen = playback.coming.filter((swing) => swing.contactAtRealMs + playback.seenLateMs <= realMs)
  playback.coming = playback.coming.filter((swing) => !seen.includes(swing))
  const events = playStageFrame(playback.run, seen, realMs, true)
  playback.events.push(...events)
  playback.coming.push(...events.flatMap((event) => swingAtRelease(playback.run, event, offsetsMs)))
}

/** Every stage event of `setup` played to its end, swung at as `offsetsMs` says, each swing seen `seenLateMs` late. */
function playOnStage(setup: StageRunSetup, offsetsMs: readonly (number | null)[], seenLateMs = SEEN_LATE_MS) {
  const playback: Playback = { run: createStageRun(setup, 0), events: [], coming: [], seenLateMs }
  for (let realMs = FRAME_MS; playback.run.derby.phase !== 'finished' && realMs < 300_000; realMs += FRAME_MS)
    stageFrame(playback, realMs, offsetsMs)
  return playback.events
}

/** How long the visitor stays out of view, from the first pitch's release. */
const AWAY_FOR_MS = 8000

/**
 * A run on stage whose visitor leaves as its first pitch is released, paused as the page pauses it, with the phase of
 * every frame it stood still on and whether a ball was in the air then, and the moment it first stood still.
 */
type AwayPlayback = Playback & {
  hud: DerbyHudState
  awayFromMs: number | null
  paused: boolean
  pausedAtMs: number | null
  stillFrames: { phase: DerbyPhase; flying: boolean }[]
}

/**
 * One frame of an away run: the stage's, then the page's pause; the first frame that stands still has the visitor
 * swing once, a second later, while still away.
 */
function awayFrame(playback: AwayPlayback, realMs: number, offsetsMs: readonly (number | null)[]) {
  const before = playback.events.length
  stageFrame(playback, realMs, offsetsMs)
  playback.hud = playback.events.slice(before).reduce(hudAfterEvent, playback.hud)
  playback.awayFromMs ??= playback.events.some((event) => event.type === 'release') ? realMs : null
  const present = playback.awayFromMs === null || realMs >= playback.awayFromMs + AWAY_FOR_MS
  const pitchCount = playback.run.derby.plan.schedule.length
  const paused = pausedForAway('play', present, betweenPitches(playback.hud, pitchCount))
  if (paused !== playback.paused) setStageRunPaused(playback.run, realMs, paused)
  playback.paused = paused
  if (!paused) return
  const { phase } = playback.run.derby
  playback.stillFrames.push({ phase, flying: playback.run.batted?.flight?.landed === false })
  if (playback.pausedAtMs !== null) return
  playback.pausedAtMs = realMs
  const contactAtRealMs = realMs + 1000
  playback.coming.push({ contactAtRealMs, startedAtRealMs: contactAtRealMs - 200, speed: 8, batHeight: 0.6 })
}

function playAway(setup: StageRunSetup, offsetsMs: readonly (number | null)[]) {
  const playback: AwayPlayback = {
    run: createStageRun(setup, 0),
    events: [],
    coming: [],
    seenLateMs: SEEN_LATE_MS,
    hud: NEW_RUN_HUD,
    awayFromMs: null,
    paused: false,
    pausedAtMs: null,
    stillFrames: [],
  }
  for (let realMs = FRAME_MS; playback.run.derby.phase !== 'finished' && realMs < 300_000; realMs += FRAME_MS)
    awayFrame(playback, realMs, offsetsMs)
  return playback
}

function flowAt(step: DerbyStep): DerbyFlow {
  const run = createDerbyRun(ballpark, october, 7, { side: 'right', practice: [] })
  const practice = [100, 110, 120].map((errorMs) => ({ errorMs, speed: 8 }))
  return { ...setupFlow(1000), step, practice, run: ['practice', 'play', 'result'].includes(step) ? run : null }
}

describe('the derby flow', () => {
  it('goes on from each step that waits by the held stance or its button alike, and from no other step', () => {
    const waiting = steps.filter((step) => stanceWait(flowAt(step)) !== null)
    expect(waiting).toEqual(['setup', 'practiceDone', 'result'])
    const started = waiting.map((step) => startedFlow(flowAt(step), 2000, plays))
    expect(started.map((flow) => flow.step)).toEqual(['practice', 'play', 'play'])
    expect(started.map((flow) => flow.since)).toEqual([2000, 2000, 2000])
    const swinging = steps.filter((step) => !waiting.includes(step)).map((step) => flowAt(step))
    expect(swinging.map((flow) => startedFlow(flow, 2000, plays))).toEqual(swinging)
    // A hold never carries over: the next step that waits waits for a new one. Only the setup comes before any swing.
    expect(stanceWait(flowAt('result'))?.key).not.toBe(stanceWait({ ...flowAt('result'), since: 5000 })?.key)
    expect(waiting.map((step) => stanceWait(flowAt(step))?.afterSwings)).toEqual([false, true, true])
  })

  it('practices at its own pace, times each swing against the contact point, and calibrates the runs after', () => {
    const practice = startedFlow(setupFlow(0), 100, plays)
    const offsetsMs = [140, 90, null, 120, 100]
    const events = playOnStage(practice.run!, offsetsMs)
    const releases = events.flatMap((event) => (event.type === 'release' ? [event.pitch.flightSeconds] : []))
    const paces = PRACTICE_SCHEDULE.map(({ type }) => PRACTICE_PITCH_FLIGHT_SECONDS * PITCH_TYPES[type].timeMultiplier)
    expect(releases).toEqual(paces)
    // Its replay at the end judges at the same pace as it played.
    const played = events.flatMap((event) => (event.type === 'result' ? [event.result] : []))
    expect(events.flatMap((event) => (event.type === 'finished' ? event.result.pitches : []))).toEqual(played)
    const done = events.reduce((flow, event) => flowAfterEvent(flow, event, 9000), practice)
    expect(done.step).toBe('practiceDone')
    expect(done.run).toBe(null)
    expect(done.practice.map((sample) => sample.errorMs)).toEqual(
      [140, 90, 120, 100].map((offsetMs) => expect.closeTo(offsetMs, 6)),
    )
    const run = startedFlow(done, 10_000, plays).run!
    expect(run.log.practice).toEqual(done.practice)
    expect(createDerby(run.plan, run.log, 0).calibration.offsetMs).toBeCloseTo(110, 0)
  })

  it('offers more practice while too few swings counted, as often as it takes, keeping within what the board takes', () => {
    // Two valid swings, and three no attempt at the pitch, more than the calibration's 400 ms off.
    const practice = [120, 900, 140, -700, 600].map((errorMs) => ({ errorMs, speed: 8 }))
    const done: DerbyFlow = { ...flowAt('practiceDone'), practice }
    expect(startsRun(done)).toBe(false)
    expect(offersMorePractice(done)).toBe(true)
    const more = startedFlow(done, 2000, plays)
    expect(more.step).toBe('practice')
    expect(more.practice.map((sample) => sample.errorMs)).toEqual([120, 140])
    expect(more.run!.log.practice).toEqual(more.practice)
    // The two kept and one sample a pitch stay within the board's five (backend/src/homeRunDerby.ts).
    expect(more.practice.length + more.run!.plan.schedule.length).toBeLessThanOrEqual(5)

    const practiced = (offsetsMs: (number | null)[]) =>
      playOnStage(more.run!, offsetsMs).reduce((flow, event) => flowAfterEvent(flow, event, 9000), more)
    const stillShort = practiced([null, null, null])
    expect(stillShort.step).toBe('practiceDone')
    expect(startedFlow(stillShort, 9500, plays).step).toBe('practice')
    const timed = practiced([null, 130, null])
    expect(timed.practice).toHaveLength(3)
    expect(offersMorePractice(timed)).toBe(false)
    const run = startedFlow(timed, 10_000, plays)
    expect(run.step).toBe('play')
    expect(run.run!.log.practice).toEqual(timed.practice)
  })

  it('plays on anyway from the offer, and a go after such a run comes back to the offer', () => {
    const practice = [{ errorMs: 120, speed: 8 }]
    const offer: DerbyFlow = { ...flowAt('practiceDone'), practice }
    const played = runFlow(offer, 2000, plays)
    expect(played.step).toBe('play')
    expect(played.run!.log.practice).toEqual(practice)
    const back = startedFlow({ ...played, step: 'result' }, 3000, plays)
    expect(back.step).toBe('practiceDone')
    expect(back.run).toBe(null)
    expect(offersMorePractice(back)).toBe(true)
    // A run only starts from a step that allows one, as when the camera stopped before the board answered.
    const setup = setupFlow(0)
    expect(runFlow(setup, 2000, plays)).toBe(setup)
  })

  it('goes on judging more practice against the swings before it, not afresh', () => {
    const earlier = [200, 220].map((errorMs) => ({ errorMs, speed: 8 }))
    const events = playOnStage(createMorePracticeRun(ballpark, october, 'left', earlier), [20, null, null])
    const [first] = events.flatMap((event) => (event.type === 'result' ? [event.result] : []))
    // Alone it would be good on its own timing; with the two before it, it is far earlier than their usual lag.
    expect(shownPracticeFeedback(first, 'normal')).toBe('early')
  })

  it('says only a bit early, good, or a bit late, the same way at every difficulty', () => {
    const difficulties: BaseballDifficulty[] = ['easy', 'normal', 'hard']
    const words = (errorMs: number) =>
      difficulties.map((difficulty) => practiceFeedback(errorMs, DIFFICULTY_RULES[difficulty].timingWindows))
    expect(words(-200)).toEqual(['early', 'early', 'early'])
    expect(words(200)).toEqual(['late', 'late', 'late'])
    expect(words(30)).toEqual(['good', 'good', 'good'])
    expect(words(80)).toEqual(['good', 'good', 'late'])
  })

  it("tells each swing against the visitor's usual timing, from its result to the next windup, none let go by", () => {
    const practice = startedFlow(setupFlow(0), 100, plays)
    // This visitor's swings register about 210 ms past the contact point; the third comes near the point itself.
    const events = playOnStage(practice.run!, [200, null, 220, 20, 210])
    let hud = NEW_RUN_HUD
    const shown = events.map((event) => {
      hud = hudAfterEvent(hud, event)
      return [event.type, shownPracticeFeedback(judgedResult(hud), 'normal')]
    })
    const words = shown.filter(([type]) => type === 'windup' || type === 'result')
    // The first two are good on their own timing, as there is no usual timing yet. The third, far earlier than the usual
    // timing it makes with them, is a bit early, and the fourth, at their usual lag, is good.
    expect(words).toEqual([
      ['windup', null],
      ['result', 'good'],
      ['windup', null],
      ['result', null],
      ['windup', null],
      ['result', 'good'],
      ['windup', null],
      ['result', 'early'],
      ['windup', null],
      ['result', 'good'],
    ])
  })

  it('hears good and is hit on every practice swing of a visitor whose swings all register 150 ms late', () => {
    const results = playOnStage(createPracticeRun(ballpark, october, 'left'), [150, 150, 150, 150, 150]).flatMap(
      (event) => (event.type === 'result' ? [event.result] : []),
    )
    // Against the contact point itself, each would be late, at the very edge of normal's contact window.
    expect(results.map((result) => shownPracticeFeedback(result, 'normal'))).toEqual(results.map(() => 'good'))
    expect(results.map((result) => result.outcome)).toEqual(results.map(() => expect.stringMatching(/^(hit|homeRun)$/)))
  })

  it('says which way a swing too far off to count missed the contact point, and counts only valid swings', () => {
    const offsetsMs = [-450, 200, 210]
    const setup = createPracticeRun(ballpark, october, 'left')
    const results = playOnStage(setup, offsetsMs).flatMap((event) => (event.type === 'result' ? [event] : []))
    const samples = results.flatMap((event) => practiceResultSample(setup.plan, event) ?? [])
    expect(samples.map((sample) => sample.errorMs)).toEqual(offsetsMs.map((offsetMs) => expect.closeTo(offsetMs, 6)))
    // The third swing is only the second valid one, so it is good on its own timing.
    expect(results.map(({ result }) => shownPracticeFeedback(result, 'normal'))).toEqual([
      'early',
      'good',
      'good',
      null,
      null,
    ])
  })

  it('takes a late practice swing the camera reports late, at the hardest difficulty, so it still calibrates', () => {
    const practice = createPracticeRun(hardBallpark, october, 'right')
    // 300 ms past the contact point, far outside hard's contact window, and seen the derby's whole margin later.
    const events = playOnStage(practice, [300, 300, 300, 300, 300], LATE_SWING_MARGIN_MS - 10)
    const results = events.flatMap((event) => (event.type === 'result' ? [event] : []))
    const samples = results.flatMap((event) => practiceResultSample(practice.plan, event) ?? [])
    expect(samples.map((sample) => sample.errorMs)).toEqual(results.map(() => expect.closeTo(300, 6)))
    // A steady lag the calibration can take off (up to 300 ms) is the visitor's usual timing, which practice does not
    // call late, even at the hardest difficulty.
    expect(results.map(({ result }) => shownPracticeFeedback(result, 'hard'))).toEqual(results.map(() => 'good'))
    const run = createDerbyRun(hardBallpark, october, 7, { side: 'right', practice: samples })
    expect(createDerby(run.plan, run.log, 0).calibration.offsetMs).toBeCloseTo(300, 0)
  })

  it('takes the same late practice swings whatever practice made of the earlier ones, so it calibrates runs the same', () => {
    // The second swing is seen later than the derby's margin past the latest swing practice takes.
    const taken = [0, 300].map((firstMs) =>
      playOnStage(createPracticeRun(ballpark, october, 'left'), [firstMs, 390], LATE_SWING_MARGIN_MS + 60).flatMap(
        (event) => (event.type === 'result' && event.swing ? [event.pitchIndex] : []),
      ),
    )
    expect(taken).toEqual([[0], [0]])
  })

  it('pauses practice and a camera run once the visitor is out of view 1.5 s, and goes on once they are back', () => {
    const watch = (from: Sight, seen: boolean, fromMs: number, toMs: number) =>
      Array.from({ length: (toMs - fromMs) / 25 + 1 }, (_, index) => fromMs + index * 25).reduce(
        (sight, now) => nextSight(sight, seen, now, AWAY_HOLD_MS),
        from,
      )
    const inView = watch(UNSEEN, true, 0, 600)
    expect([watch(inView, false, 1000, 2400).seen, watch(inView, false, 1000, 2500).seen]).toEqual([true, false])
    const away = watch(inView, false, 1000, 2500)
    expect([watch(away, true, 3000, 3400).seen, watch(away, true, 3000, 3500).seen]).toEqual([false, true])
    const pausing = steps.filter((step) => pausedForAway(step, false, true))
    expect(pausing).toEqual(['practice', 'play'])
    const otherwise = steps.filter((step) => pausedForAway(step, true, true) || pausedForAway(step, false, false))
    expect(otherwise).toEqual([])
  })

  it('stands still only between pitches: a pitch away plays out, and a swing made meanwhile meets no pitch', () => {
    const { run, stillFrames, pausedAtMs, awayFromMs } = playAway(plays.run([]), [0, null, null, null, null])
    expect(stillFrames.length).toBeGreaterThan(0)
    expect(pausedAtMs! - awayFromMs!).toBeGreaterThan(1000)
    // No ball ever stood still on its way or in the air.
    expect(stillFrames.filter((frame) => frame.phase === 'pitch' || frame.flying)).toEqual([])
    // The pitch already on its way kept its swing; the swing while the run stood still met no pitch.
    expect(run.derby.log.swings[0]).not.toBe(null)
    expect(run.derby.log.swings.slice(1)).toEqual([null, null, null, null])
    expect(run.derby.phase).toBe('finished')
  })

  it('goes back to the rules card, dropping the run, when the camera turns off, as after 2 minutes idle', () => {
    const cameraSteps = steps.map((step) => flowAt(step))
    const offSteps = cameraSteps.map((flow) => derbyStep(flow, 'off'))
    expect(offSteps).toEqual(steps.map(() => 'rules'))
    expect(cameraSteps.map((flow) => shownRun(flow, derbyStep(flow, 'off')))).toEqual(steps.map(() => null))
    // Until the camera is ready to play again, or while it names a problem, the setup shows, with no run.
    const notReady = cameraKinds.filter((kind) => kind !== 'off' && kind !== 'ready')
    expect(notReady.map((kind) => derbyStep(flowAt('play'), kind))).toEqual(notReady.map(() => 'setup'))
    expect(derbyStep(flowAt('play'), 'ready')).toBe('play')
  })
})

describe('a derby run', () => {
  it('plays the rules of the KST month it starts in, so a run past midnight in Korea gets the new month', () => {
    const scheduled: BallparkSettings = {
      ...ballpark,
      scheduledRules: { fromMonth: '2026-11', rules: { pitchCount: 8, difficulty: 'hard' } },
    }
    const log = { side: 'right' as const, practice: [] }
    const lastOctoberRun = createDerbyRun(scheduled, new Date('2026-10-31T14:59:00Z'), 7, log)
    const firstNovemberRun = createDerbyRun(scheduled, new Date('2026-10-31T15:01:00Z'), 7, log)
    expect(lastOctoberRun.plan.rules).toEqual(scheduled.rules)
    expect(firstNovemberRun.plan.rules).toEqual(scheduled.scheduledRules!.rules)
    expect(firstNovemberRun.plan.schedule).toHaveLength(8)
    const practice = createPracticeRun(scheduled, new Date('2026-10-31T15:01:00Z'), 'right')
    expect(practice.plan.rules.difficulty).toBe('hard')
  })
})
