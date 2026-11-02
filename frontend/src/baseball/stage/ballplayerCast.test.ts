import { Quaternion, Vector3 } from 'three'
import { describe, expect, it } from 'vitest'
import type { Vec3 } from '../../data/models'
import { DEFAULT_PLAYER_PROFILE } from '../../data/playerProfile'
import { CALIBRATION_RULES } from '../game/calibration'
import { DERBY_PHASE_MS } from '../game/derby'
import type { BattingSide } from '../game/field'
import { gameTime } from '../game/gameClock'
import { contactSeconds, RELEASE_POINT } from '../game/pitch'
import { createRunPlan } from '../game/runPlan'
import { type BallplayerRig, turnHead } from './actors/ballplayerRig'
import { BAT } from './actors/bat'
import {
  batterPoseAt,
  beginSwing,
  CONTACT_POINT,
  createBatter,
  NO_SWING,
  poseBatter,
  swingHeadWeight,
} from './actors/batter'
import { CONTACT_DELAY_MS } from './actors/swingMotion'
import {
  type BallplayerCast,
  batterLoad,
  createCast,
  createFielders,
  cueBatter,
  perfectMeetPoint,
  posePitcherAt,
  posePlayers,
  settleBatter,
} from './ballplayerCast'
import { type CastFrame, FRAME_MS, levelSwing, playWithCast } from '../../testing/castPlays'
import {
  advanceStageRun,
  createStageRun,
  cueStageSwing,
  playStageFrame,
  type RealTimeSwingCue,
  type StageRun,
  stageBallView,
  swingStageRun,
} from './stageRun'

/**
 * A one-pitch run on `side` with a swing the camera reports `offsetMs` after the ball reaches the contact point, handed
 * in a frame after it was made, after a practice whose swings all registered `practiceOffsetMs` late, which the
 * calibration takes off.
 */
function swungRun(side: BattingSide, offsetMs: number, practiceOffsetMs = 0) {
  const plan = createRunPlan({ pitchCount: 1, difficulty: 'normal' }, 7)
  const practice = Array.from({ length: CALIBRATION_RULES.minimumValidSwings }, () => ({
    errorMs: practiceOffsetMs,
    speed: CALIBRATION_RULES.peakFloor,
  }))
  const run = createStageRun({ plan, log: { side, practice } }, 0)
  const release = advanceStageRun(run, DERBY_PHASE_MS.ready + DERBY_PHASE_MS.windup, false).at(-1)
  if (release?.type !== 'release') throw new Error('expected the release')
  // No hit-stop or slow motion has changed the clock yet, so game time is real time.
  const contactAtRealMs = release.releasedMs + contactSeconds(release.pitch) * 1000 + offsetMs
  swingStageRun(run, levelSwing(release.pitch, contactAtRealMs), contactAtRealMs + 17)
  advanceStageRun(run, contactAtRealMs + 17, false)
  return { run, contactAtMs: contactAtRealMs }
}

function worldSweetSpot({ batter }: BallplayerCast) {
  batter.rig.root.updateMatrixWorld(true)
  return batter.bat.localToWorld(new Vector3(0, BAT.sweetSpot, 0))
}

/** The bat's sweet spot (field meters) with the batter posed at `nowMs`. */
function sweetSpotAt(cast: BallplayerCast, run: StageRun, nowMs: number) {
  const { batter } = cast
  poseBatter(batter, batterPoseAt(batter, nowMs, batterLoad(run, nowMs), false))
  return worldSweetSpot(cast)
}

/** How far (m) the bat's sweet spot is from the ball in play as the bat meets it, once the cast has seen the swing. */
function batMissesBall(cast: BallplayerCast, run: StageRun) {
  cueBatter(cast, run)
  const { start, meetMs } = run.batted!
  return sweetSpotAt(cast, run, meetMs).distanceTo(new Vector3(start.x, start.y, start.z))
}

/** Degrees between where a posed head faces and the way to `point`. */
function headOffBall(rig: BallplayerRig, point: Vec3) {
  rig.root.updateMatrixWorld(true)
  const head = rig.head.getWorldPosition(new Vector3())
  const facing = new Vector3(0, 0, 1).transformDirection(rig.head.matrixWorld)
  return (facing.angleTo(new Vector3(point.x, point.y, point.z).sub(head)) * 180) / Math.PI
}

function distance(from: Vec3, to: Vec3) {
  return Math.hypot(to.x - from.x, to.y - from.y, to.z - from.z)
}

/**
 * A one-pitch normal run on the right played with `cast` a frame every FRAME_MS, the way the director plays it: the
 * camera cues the swing's start `cueLeadMs` before its PERFECT contact, expecting it then (null: no cue), and reports
 * the swing `reportMs` after it. `contactAtMs` is that contact (game ms, which is real time until the bat meets the
 * ball), once the pitch is on its way.
 */
type CuedPlay = {
  cast: BallplayerCast
  run: StageRun
  cueLeadMs: number | null
  reportMs: number
  contactAtMs: number | null
  cued: boolean
  reported: boolean
}

/** One frame of `play` at `realMs`: game time, whether the bat met the ball, the bat's azimuth, and the sweet spot. */
function cuedFrame(play: CuedPlay, realMs: number) {
  const { cast, run, contactAtMs } = play
  const due = contactAtMs ?? Infinity
  const cueDue = play.cueLeadMs !== null && !play.cued && realMs >= due - play.cueLeadMs
  const cues: RealTimeSwingCue[] = cueDue ? [{ kind: 'started', crossingAtRealMs: due }] : []
  const swingDue = run.pitch !== null && !play.reported && realMs >= due + play.reportMs
  const swings = swingDue && run.pitch ? [levelSwing(run.pitch.plan, due)] : []
  play.cued = play.cued || cueDue
  play.reported = play.reported || swingDue
  const events = playStageFrame(run, swings, realMs, false, cues)
  const release = events.find((event) => event.type === 'release')
  if (release?.type === 'release') play.contactAtMs = release.releasedMs + contactSeconds(release.pitch) * 1000
  const nowMs = gameTime(run.clock, realMs)
  posePlayers(cast, run, nowMs, stageBallView(run, nowMs, posePitcherAt(cast, run, nowMs)), FRAME_MS / 1000)
  const azimuth = batterPoseAt(cast.batter, nowMs, batterLoad(run, nowMs), true).batAzimuth
  const met = events.some((event) => event.type === 'contact')
  return { nowMs, cued: cueDue, met, azimuth, sweetSpot: worldSweetSpot(cast) }
}

/** Plays a one-pitch run (CuedPlay) until its result is a second old: each frame, and the run. */
function playCued(cueLeadMs: number | null, reportMs: number) {
  const cast = createCast(createBatter(DEFAULT_PLAYER_PROFILE, 'right'), createFielders())
  const plan = createRunPlan({ pitchCount: 1, difficulty: 'normal' }, 7)
  const run = createStageRun({ plan, log: { side: 'right', practice: [] } }, 0)
  const play: CuedPlay = { cast, run, cueLeadMs, reportMs, contactAtMs: null, cued: false, reported: false }
  const frames = Array.from({ length: 360 }, (_, frame) => cuedFrame(play, (frame + 1) * FRAME_MS))
  return { frames, run }
}

/** The clock a frame's work reads when every step overruns the frame: one step a frame. */
const OVERRUN = () => Infinity

describe('ballplayer cast', () => {
  it('aims a judged hit a step a frame, drawing the swing before it until done, then as if aimed at once', () => {
    const { run } = swungRun('right', 0)
    const atOnce = createCast(createBatter(DEFAULT_PLAYER_PROFILE, 'right'), createFielders())
    cueBatter(atOnce, run)
    const stepped = createCast(createBatter(DEFAULT_PLAYER_PROFILE, 'right'), createFielders())
    let frames = 0
    while (!settleBatter(stepped, run, 0, OVERRUN) && frames < 10_000) {
      frames += 1
      expect(stepped.batter.swing).toBe(NO_SWING)
      // Each frame poses the batter between the steps, as the director does.
      poseBatter(stepped.batter, batterPoseAt(stepped.batter, 3000 + frames, 1, true))
    }
    expect(frames).toBeGreaterThan(20)
    expect(stepped.batter.swing).toEqual(atOnce.batter.swing)
  })

  it('holds the clock for a judged hit only a few frames, even on a computer several times slower', () => {
    const { run } = swungRun('right', 0)
    // Frames until the judged hit is solved when each of its steps takes `stepMs`: about 0.05 on a fast laptop.
    const framesAt = (stepMs: number) => {
      const cast = createCast(createBatter(DEFAULT_PLAYER_PROFILE, 'right'), createFielders())
      let clockMs = 0
      const now = () => (clockMs += stepMs)
      let frames = 1
      while (!settleBatter(cast, run, clockMs, now) && frames < 10_000) frames += 1
      return frames
    }
    expect(framesAt(0.1)).toBeLessThanOrEqual(4)
    expect(framesAt(1)).toBeLessThanOrEqual(8)
  })

  it('solves a swing’s aim ahead during the windup, which the swing then begun takes as it would solve it', () => {
    const plan = createRunPlan({ pitchCount: 1, difficulty: 'normal' }, 7)
    const run = createStageRun({ plan, log: { side: 'right', practice: [] } }, 0)
    advanceStageRun(run, DERBY_PHASE_MS.ready + 100, false)
    const cast = createCast(createBatter(DEFAULT_PLAYER_PROFILE, 'right'), createFielders())
    for (let frame = 0; frame < 10_000 && cast.batter.prepared.length < 2; frame += 1)
      settleBatter(cast, run, 0, OVERRUN)
    const releasedMs = DERBY_PHASE_MS.ready + DERBY_PHASE_MS.windup
    advanceStageRun(run, releasedMs, false)
    const crossingMs = releasedMs + contactSeconds(run.pitch!.plan) * 1000
    cueStageSwing(run, { kind: 'started', crossingAtRealMs: crossingMs }, crossingMs - 50)
    settleBatter(cast, run, 0, OVERRUN)
    const prepared = cast.batter.prepared.map(({ aim }) => aim.solvedShift)
    expect(prepared).toContain(cast.batter.swing.solvedShift)
    const solvedNow = createBatter(DEFAULT_PLAYER_PROFILE, 'right')
    const { startedMs, readyMs } = run.shown!.begun!
    beginSwing(solvedNow, startedMs, readyMs, batterLoad(run, startedMs), perfectMeetPoint(run))
    expect(cast.batter.swing).toEqual(solvedNow.swing)
  })

  it('swings the batter so its bat meets each ball in play where and when the stage sends it off', () => {
    const sides: BattingSide[] = ['right', 'left']
    const misses = sides.flatMap((side) => {
      const cast = createCast(createBatter(DEFAULT_PLAYER_PROFILE, side), createFielders())
      return [-120, 0, 100].map((offsetMs) => batMissesBall(cast, swungRun(side, offsetMs).run))
    })
    expect(Math.max(...misses)).toBeLessThan(0.002)
  })

  it('swings the batter through the contact point at a miss’s judged moment, never before its last stretch', () => {
    const contactPoint = new Vector3(CONTACT_POINT.x, CONTACT_POINT.y, CONTACT_POINT.z)
    // The stage takes each swing 17 ms after its report. Uncalibrated, judged when reported, so the bat gets there its
    // last stretch after the stage took it; an early swinger's, judged 150 ms after the report, still to come then; and
    // a late camera's, judged 300 ms before its report, as late as the uncalibrated one.
    const lastStretchMs = 17 + CONTACT_DELAY_MS
    const misses = [
      { practiceOffsetMs: 0, afterReportMs: lastStretchMs },
      { practiceOffsetMs: -150, afterReportMs: 150 },
      { practiceOffsetMs: 300, afterReportMs: lastStretchMs },
    ].map(({ practiceOffsetMs, afterReportMs }) => {
      const cast = createCast(createBatter(DEFAULT_PLAYER_PROFILE, 'right'), createFielders())
      const { run, contactAtMs } = swungRun('right', practiceOffsetMs + 200, practiceOffsetMs)
      cueBatter(cast, run)
      return {
        outcome: run.derby.results[0].outcome,
        offPoint: sweetSpotAt(cast, run, contactAtMs + afterReportMs).distanceTo(contactPoint),
      }
    })
    expect(misses.map(({ outcome }) => outcome)).toEqual(['miss', 'miss', 'miss'])
    expect(Math.max(...misses.map(({ offPoint }) => offPoint))).toBeLessThan(0.002)
  })

  it('starts the batter as the camera cues a swing, then carries it onto the ball without a jump or going back', () => {
    // Cued 60 ms before a PERFECT contact and reported 40 ms after it, or reported alone.
    const cued = playCued(60, 40)
    const reportedOnly = playCued(null, 40)
    const cueFrame = cued.frames.findIndex((frame) => frame.cued)
    expect(cueFrame).toBeGreaterThan(0)
    // A frame after the cue, the batter has left the windup it still stands in when the camera cues nothing.
    const moved = cued.frames[cueFrame + 1].sweetSpot.distanceTo(reportedOnly.frames[cueFrame + 1].sweetSpot)
    expect(moved).toBeGreaterThan(0.01)
    // It meets the ball where the stage sends it off, the hit-stop holding them together.
    const { start } = cued.run.batted!
    const metFrame = cued.frames.find((frame) => frame.met)!
    expect(metFrame.nowMs).toBe(cued.run.batted!.meetMs)
    expect(metFrame.sweetSpot.distanceTo(new Vector3(start.x, start.y, start.z))).toBeLessThan(0.002)
    // From the cue to the finish the bat only goes on, and no faster a frame than a swing the camera cued nothing of.
    const turns = (frames: typeof cued.frames) =>
      frames.slice(cueFrame + 1, cueFrame + 50).map(({ azimuth }, frame) => azimuth - frames[cueFrame + frame].azimuth)
    expect(Math.min(...turns(cued.frames))).toBeGreaterThan(-1e-6)
    expect(Math.max(...turns(cued.frames))).toBeLessThanOrEqual(Math.max(...turns(reportedOnly.frames)))
  })

  it('holds the ball in the pitcher’s hand up to the release point as the derby releases it', () => {
    const cast = createCast(createBatter(DEFAULT_PLAYER_PROFILE, 'right'), createFielders())
    const releaseMs = DERBY_PHASE_MS.ready + DERBY_PHASE_MS.windup
    const inHand = new Map<number, Vec3>()
    playWithCast(cast, 'right', [null], ({ nowMs }) => inHand.set(nowMs, cast.pitcher.ballPoint.clone()))
    expect(distance(inHand.get(releaseMs - FRAME_MS)!, RELEASE_POINT)).toBeLessThan(0.1)
    expect(distance(inHand.get(releaseMs)!, RELEASE_POINT)).toBeLessThan(0.005)
  })

  it('keeps the batter’s head on its swing’s own turn mid-swing and every fielder’s eyes on a ball in play', () => {
    const cast = createCast(createBatter(DEFAULT_PLAYER_PROFILE, 'left'), createFielders())
    const { batter, pitcher, catcher } = cast
    const keyed = new Quaternion()
    const offKeyed: number[] = []
    const fieldersOffBall: number[] = []
    const watch = ({ nowMs, view, run }: CastFrame) => {
      const sinceMeeting = run.batted?.flight ? nowMs - run.batted.meetMs : -1
      if (sinceMeeting > 60 && sinceMeeting < 160)
        fieldersOffBall.push(headOffBall(pitcher.rig, view.position), headOffBall(catcher.rig, view.position))
      if (swingHeadWeight(batter, nowMs) < 1) return
      const posed = batter.rig.head.quaternion.clone()
      const pose = batterPoseAt(batter, nowMs, batterLoad(run, nowMs), true)
      turnHead(batter.rig, pose.headYaw, pose.headPitch, pose.headRoll)
      offKeyed.push(posed.angleTo(keyed.copy(batter.rig.head.quaternion)))
    }
    playWithCast(cast, 'left', [0], watch, { delta: 10 })
    expect(offKeyed.length).toBeGreaterThan(10)
    expect(Math.max(...offKeyed)).toBeLessThan(1e-6)
    expect(fieldersOffBall.length).toBeGreaterThan(5)
    expect(Math.max(...fieldersOffBall)).toBeLessThan(0.5)
  })
})
