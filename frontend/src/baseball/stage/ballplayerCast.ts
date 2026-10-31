import { Vector3 } from 'three'
import type { Vec3 } from '../../data/models'
import { clamp01, lerp, smoothstep } from '../../motionMath'
import { DERBY_PHASE_MS } from '../game/derby'
import { STRIKE_ZONE } from '../game/field'
import { contactSeconds, pitchPosition, RELEASE_POINT } from '../game/pitch'
import {
  type Batter,
  batterPoseAt,
  NO_SWING,
  poseBatter,
  startSwing,
  swingHeadWeight,
  turnHeadClearOfBat,
} from './actors/batter'
import { type Catcher, createCatcher, disposeCatcher, poseCatcher } from './actors/catcher'
import { easeLook, fieldToRig, type HeadLook, type HeadRange, lookToward, watch } from './actors/headLook'
import { createPitcher, disposePitcher, type Pitcher, posePitcher } from './actors/pitcher'
import { CONTACT_DELAY_MS, FINISH_HOLD_MS, RETURN_MS, SWING_MS } from './actors/swingMotion'
import type { BallView } from './ballMeshes'
import { MITT_DEPTH } from './stageLayout'
import { ballIsThePitchers, mittSeconds, type PitchOnStage, type StageRun } from './stageRun'

// The three players on the derby's clock: the pitcher throws on the derby's windup and release, the batter loads with
// the windup and swings each judged swing so its bat meets the ball where and when the stage sends it off, and the
// catcher's mitt goes where a pitch will end up. Every head follows the ball, the pitcher's watching the mitt while the
// ball is still his and as it leaves his hand. They only show what the derby decided; nothing here changes a run.

export type Fielders = { pitcher: Pitcher; catcher: Catcher }

/**
 * The players and what they remember between frames: where the batter's eyes are, and the run and the pitch the batter
 * last swung at, so each judged swing starts once.
 */
export type BallplayerCast = Fielders & {
  batter: Batter
  batterLook: HeadLook
  run: StageRun | null
  swungAt: PitchOnStage | null
}

/** A swing the batter shows: when it starts (game ms) and the ball it meets (field meters; null for a miss). */
export type BatterSwingCue = { pitch: PitchOnStage; startMs: number; point: Vec3 | null }

/** How far each head turns (degrees in its rig frame, yaw from its +z toward +x, pitch down). */
export const HEAD_RANGES = {
  batter: { yaw: [-40, 130], pitch: [-60, 60] },
  pitcher: { yaw: [-100, 100], pitch: [-50, 45] },
  catcher: { yaw: [-80, 80], pitch: [-60, 50] },
} satisfies Record<string, HeadRange>

/** The catcher's target before each pitch: the strike zone's center at the mitt. */
export const MITT_SET_TARGET: Vec3 = { x: 0, y: STRIKE_ZONE.center, z: -MITT_DEPTH }
/** The batter's front foot comes down this long before the ball reaches the contact point (the research's median). */
export const FOOT_DOWN_LEAD_MS = 175
/** The share of the windup gone before the batter starts lifting its front foot. */
export const BATTER_LOAD_START = 0.35
/** The pitcher keeps his eyes on the mitt through his release, until the ball is this far (m) on its way. */
export const PITCHER_EYES_ON_MITT = 2

export function createFielders(): Fielders {
  return { pitcher: createPitcher(), catcher: createCatcher(MITT_SET_TARGET) }
}

export function disposeFielders({ pitcher, catcher }: Fielders) {
  disposePitcher(pitcher)
  disposeCatcher(catcher)
}

export function createCast(batter: Batter, fielders: Fielders): BallplayerCast {
  return { ...fielders, batter, batterLook: { yaw: 85, pitch: 5 }, run: null, swungAt: null }
}

/** Seconds from a release the pitcher is at: winding up toward the next, or on from the last; before any, his set. */
export function throwSeconds(run: StageRun | null, nowMs: number) {
  if (!run) return -Infinity
  const { derby, pitch } = run
  if (derby.phase === 'windup') return (nowMs - derby.phaseStartedMs - DERBY_PHASE_MS.windup) / 1000
  return pitch ? (nowMs - pitch.releasedMs) / 1000 : -Infinity
}

/** Poses the pitcher for `nowMs` (game ms) and returns where the ball in his hand is (field meters). */
export function posePitcherAt(cast: BallplayerCast, run: StageRun | null, nowMs: number) {
  posePitcher(cast.pitcher, throwSeconds(run, nowMs))
  return cast.pitcher.ballPoint
}

/** The swing the batter shows for the pitch on stage once the derby has judged one, or null. */
export function batterSwingCue(run: StageRun | null): BatterSwingCue | null {
  if (!run?.pitch) return null
  const { pitch, batted } = run
  const swing = run.derby.log.swings[pitch.index]
  if (!swing) return null
  if (batted?.pitchIndex === pitch.index)
    return { pitch, startMs: batted.meetMs - CONTACT_DELAY_MS, point: batted.start }
  return { pitch, startMs: pitch.releasedMs + swing.contactMs - CONTACT_DELAY_MS, point: null }
}

/** The batter's load `ms` (game ms) into a pitch: the toe lifted at the release, the front foot down before contact. */
export function strideLoad(pitch: PitchOnStage, ms: number) {
  const footDownMs = contactSeconds(pitch.plan) * 1000 - FOOT_DOWN_LEAD_MS
  return 0.5 + 0.5 * smoothstep(clamp01((ms - pitch.releasedMs) / footDownMs))
}

/**
 * How far back into its stance (0..1) the batter has settled during a result: from the start of a swing's return, or
 * for a pitch let go from the result's start, over RETURN_MS.
 */
export function settledAmount(run: StageRun, nowMs: number) {
  const cue = batterSwingCue(run)
  const fromMs = cue ? cue.startMs + SWING_MS + FINISH_HOLD_MS : run.derby.phaseStartedMs
  return smoothstep(clamp01((nowMs - fromMs) / RETURN_MS))
}

/** The batter's windup load at `nowMs` (game ms): 0 standing in, 0.5 the toe lift at the release, 1 the foot down. */
export function batterLoad(run: StageRun | null, nowMs: number) {
  if (!run) return 0
  const { derby, pitch } = run
  if (derby.phase === 'windup') {
    const progress = (nowMs - derby.phaseStartedMs) / DERBY_PHASE_MS.windup
    return 0.5 * smoothstep(clamp01((progress - BATTER_LOAD_START) / (1 - BATTER_LOAD_START)))
  }
  if (!pitch || (derby.phase !== 'pitch' && derby.phase !== 'result')) return 0
  const settled = derby.phase === 'result' ? settledAmount(run, nowMs) : 0
  return strideLoad(pitch, nowMs) * (1 - settled)
}

/** Where the catcher wants his mitt: where the pitch on its way will end up, or his target between pitches. */
export function mittTarget(run: StageRun | null): Vec3 {
  const pitching = run?.derby.phase === 'pitch' || run?.derby.phase === 'result'
  if (!run?.pitch || !pitching) return MITT_SET_TARGET
  return pitchPosition(run.pitch.plan, mittSeconds(run.pitch.plan))
}

/** A new run starts the batter afresh; each judged swing starts the batter's swing once. */
export function cueBatter(cast: BallplayerCast, run: StageRun | null) {
  if (cast.run !== run) {
    cast.run = run
    cast.swungAt = null
    cast.batter.swing = NO_SWING
  }
  const cue = batterSwingCue(run)
  if (!cue || cue.pitch === cast.swungAt) return
  cast.swungAt = cue.pitch
  startSwing(cast.batter, cue.startMs, strideLoad(cue.pitch, cue.startMs), cue.point)
}

const batterBall = new Vector3()

/**
 * Poses the batter at `nowMs` (game ms) with its eyes on `ball` (field meters), eased over `delta` seconds; while it
 * swings, the swing's own head turn takes over. The head turns only as far as the bat lets it.
 */
export function poseBatterAt(cast: BallplayerCast, run: StageRun | null, nowMs: number, ball: Vec3, delta: number) {
  const { batter, batterLook } = cast
  const pose = batterPoseAt(batter, nowMs, batterLoad(run, nowMs), true)
  poseBatter(batter, pose)
  easeLook(batterLook, lookToward(batter.rig, fieldToRig(batter.rig, ball, batterBall), HEAD_RANGES.batter), delta)
  const own = swingHeadWeight(batter, nowMs)
  const look = { yaw: lerp(batterLook.yaw, pose.headYaw, own), pitch: lerp(batterLook.pitch, pose.headPitch, own) }
  turnHeadClearOfBat(batter, pose, look)
}

/**
 * Poses the batter and the catcher at `nowMs` (game ms), the pitcher having been posed for the ball already, and turns
 * every head toward `view`'s ball, easing over `delta` seconds; a hidden ball leaves the heads where they are.
 */
export function posePlayers(cast: BallplayerCast, run: StageRun | null, nowMs: number, view: BallView, delta: number) {
  const { pitcher, catcher } = cast
  const eased = view.visible ? delta : 0
  cueBatter(cast, run)
  poseBatterAt(cast, run, nowMs, view.position, eased)
  poseCatcher(catcher, mittTarget(run), delta)
  watch(catcher.rig, catcher.look, view.position, HEAD_RANGES.catcher, eased)
  watch(pitcher.rig, pitcher.look, pitcherTarget(run, view.position, catcher.mittPoint), HEAD_RANGES.pitcher, eased)
}

/** What the pitcher watches: the catcher's mitt while the ball is his and just after he lets it go, then the ball. */
export function pitcherTarget(run: StageRun | null, ball: Vec3, mitt: Vec3): Vec3 {
  const fromRelease = Math.hypot(ball.x - RELEASE_POINT.x, ball.y - RELEASE_POINT.y, ball.z - RELEASE_POINT.z)
  return ballIsThePitchers(run) || fromRelease < PITCHER_EYES_ON_MITT ? mitt : ball
}
