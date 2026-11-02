// For tests only: derbies played with the ballplayer cast the way the director plays them, a frame at a time, and how
// the batter's head fares in one as its eyes follow the ball. Nothing in the app imports this, so it never reaches the
// production bundle.
import { MathUtils, Quaternion } from 'three'
import { DEFAULT_PLAYER_PROFILE, type PlayerProfile } from '../data/playerProfile'
import type { BattingSide } from '../baseball/game/field'
import { gameTime } from '../baseball/game/gameClock'
import { contactHeight, contactSeconds, type PitchPlan } from '../baseball/game/pitch'
import { createRunPlan } from '../baseball/game/runPlan'
import { createBatter } from '../baseball/stage/actors/batter'
import type { BallView } from '../baseball/stage/ballMeshes'
import {
  type BallplayerCast,
  createCast,
  createFielders,
  posePitcherAt,
  posePlayers,
} from '../baseball/stage/ballplayerCast'
import {
  createStageRun,
  playStageFrame,
  type RealTimeSwing,
  type RealTimeSwingCue,
  type StageEvent,
  type StageRun,
  stageBallView,
} from '../baseball/stage/stageRun'
import { batterOverlaps, OVERLAP_PAIRS } from './batterOverlap'

export const FRAME_MS = 10

/** A camera swing with the bat level with `pitch` at `contactAtRealMs`. */
export function levelSwing(pitch: PitchPlan, contactAtRealMs: number): RealTimeSwing {
  return { contactAtRealMs, startedAtRealMs: contactAtRealMs - 200, speed: 8, batHeight: contactHeight(pitch) }
}

/** One frame as the director draws it, after posing the cast: game time and the ball. */
export type CastFrame = { nowMs: number; view: BallView; run: StageRun }

/**
 * How the visitor meets each pitch: a swing this many ms off PERFECT, null to let it go, or 'checked', a swing the
 * camera sees begin 120 ms before PERFECT and checked 40 ms later.
 */
export type PitchPlay = number | null | 'checked'

/** Real ms the stage reaches game ms `gameMs` at, at the run's clock rate now. */
export function realMsAt(run: StageRun, gameMs: number) {
  return run.clock.realMs + (gameMs - run.clock.gameMs) / run.clock.rate
}

/** The swing at a pitch released among `events`, `plays[pitch]` ms off PERFECT, or null for none. */
export function swingAtRelease(run: StageRun, events: StageEvent[], plays: PitchPlay[]): RealTimeSwing | null {
  const release = events.find((event) => event.type === 'release')
  const offsetMs = release?.type === 'release' ? plays[release.pitchIndex] : null
  if (release?.type !== 'release' || typeof offsetMs !== 'number') return null
  const atGameMs = release.releasedMs + contactSeconds(release.pitch) * 1000 + offsetMs
  return levelSwing(release.pitch, realMsAt(run, atGameMs))
}

/** The camera's cues (and the real ms each comes at) for a pitch released among `events` that `plays` checks. */
export function cuesAtRelease(run: StageRun, events: StageEvent[], plays: PitchPlay[]) {
  const release = events.find((event) => event.type === 'release')
  if (release?.type !== 'release' || plays[release.pitchIndex] !== 'checked') return []
  const crossingAtRealMs = realMsAt(run, release.releasedMs + contactSeconds(release.pitch) * 1000)
  return [
    { atMs: crossingAtRealMs - 120, cue: { kind: 'started', crossingAtRealMs } },
    { atMs: crossingAtRealMs - 80, cue: { kind: 'checked' } },
  ] satisfies { atMs: number; cue: RealTimeSwingCue }[]
}

/**
 * Plays a normal run on `side` with `cast` the way the director does, a frame every `frameMs`: each pitch met as
 * `plays` says, a swing handed in with the next frame, the heads eased `delta` seconds a frame.
 */
export function playWithCast(
  cast: BallplayerCast,
  side: BattingSide,
  plays: PitchPlay[],
  watch: (frame: CastFrame) => void,
  { frameMs = FRAME_MS, delta = frameMs / 1000 }: { frameMs?: number; delta?: number } = {},
) {
  const plan = createRunPlan({ pitchCount: plays.length, difficulty: 'normal' }, 7)
  const run = createStageRun({ plan, log: { side, practice: [] } }, 0)
  let pending: RealTimeSwing | null = null
  let cues: { atMs: number; cue: RealTimeSwingCue }[] = []
  for (let realMs = frameMs; run.derby.phase !== 'finished'; realMs += frameMs) {
    const handedIn: RealTimeSwing[] = pending && pending.contactAtRealMs < realMs ? [pending] : []
    pending = handedIn.length > 0 ? null : pending
    const due = cues.filter(({ atMs }) => atMs <= realMs).map(({ cue }) => cue)
    cues = cues.filter(({ atMs }) => atMs > realMs)
    const events = playStageFrame(run, handedIn, realMs, false, due)
    pending = pending ?? swingAtRelease(run, events, plays)
    cues = [...cues, ...cuesAtRelease(run, events, plays)]
    const nowMs = gameTime(run.clock, realMs)
    const view = stageBallView(run, nowMs, posePitcherAt(cast, run, nowMs))
    posePlayers(cast, run, nowMs, view, delta)
    watch({ nowMs, view, run })
  }
}

/**
 * Plays a home run, an early and a late swing, a pitch let go into the mitt, and a swing the camera saw begin and
 * checked, on `side` wearing `look`, a frame every 4 ms so a jump shows: the eyes follow the ball, and the swing's own
 * head turn hands over to them on the way back. Returns the deepest (field m) anything of the batter sinks into
 * anything, measured every fifth frame, and the most (degrees) its head turns off the even way between the frames
 * either side: as the hit-stop stops a swing's fast head turn, a few degrees; a head that jumps in a frame, half its jump.
 */
export function headFollowingBall(side: BattingSide, look: Partial<PlayerProfile>) {
  const cast = createCast(createBatter({ ...DEFAULT_PLAYER_PROFILE, ...look }, side), createFielders())
  const depths: number[] = []
  const heads: Quaternion[] = []
  const watch = () => {
    cast.batter.rig.root.updateMatrixWorld(true)
    heads.push(cast.batter.rig.head.getWorldQuaternion(new Quaternion()))
    if (heads.length % 5 !== 0) return
    const overlaps = batterOverlaps(cast.batter)
    depths.push(Math.max(...OVERLAP_PAIRS.map((pair) => overlaps[pair])))
  }
  playWithCast(cast, side, [0, -160, 150, null, 'checked'], watch, { frameMs: 4 })
  const twitches = heads.slice(2).map((head, index) => heads[index + 1].angleTo(heads[index].clone().slerp(head, 0.5)))
  return { depth: Math.max(...depths), twitch: MathUtils.radToDeg(Math.max(...twitches)) }
}
