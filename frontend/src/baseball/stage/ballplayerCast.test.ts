import { Quaternion, Vector3 } from 'three'
import { describe, expect, it } from 'vitest'
import type { Vec3 } from '../../data/models'
import { DEFAULT_PLAYER_PROFILE, type PlayerProfile } from '../../data/playerProfile'
import { DERBY_PHASE_MS } from '../game/derby'
import type { BattingSide } from '../game/field'
import { gameTime } from '../game/gameClock'
import { contactSeconds, RELEASE_POINT } from '../game/pitch'
import { createRunPlan } from '../game/runPlan'
import { type BallplayerRig, turnHead } from './actors/ballplayerRig'
import { BAT } from './actors/bat'
import { batInHead, batterPoseAt, CONTACT_POINT, createBatter, poseBatter, swingHeadWeight } from './actors/batter'
import type { BallView } from './ballMeshes'
import {
  type BallplayerCast,
  batterLoad,
  createCast,
  createFielders,
  cueBatter,
  posePitcherAt,
  posePlayers,
} from './ballplayerCast'
import { PLAYER_SCALE } from './stageLayout'
import {
  advanceStageRun,
  createStageRun,
  playStageFrame,
  type RealTimeSwing,
  type StageEvent,
  type StageRun,
  stageBallView,
  swingStageRun,
} from './stageRun'

const FRAME_MS = 10

/** A one-pitch keyboard run on `side` with a swing `offsetMs` off PERFECT, handed in a frame after it was made. */
function swungRun(side: BattingSide, offsetMs: number) {
  const plan = createRunPlan({ pitchCount: 1, difficulty: 'normal' }, 7)
  const run = createStageRun({ plan, log: { input: 'keyboard', side, practice: [] } }, 0)
  const release = advanceStageRun(run, DERBY_PHASE_MS.ready + DERBY_PHASE_MS.windup, false).at(-1)
  if (release?.type !== 'release') throw new Error('expected the release')
  // No hit-stop or slow motion has changed the clock yet, so game time is real time.
  const contactAtRealMs = release.releasedMs + contactSeconds(release.pitch) * 1000 + offsetMs
  const swing: RealTimeSwing = {
    source: 'keyboard',
    contactAtRealMs,
    startedAtRealMs: contactAtRealMs,
    speed: 0,
    batHeight: null,
  }
  swingStageRun(run, swing, contactAtRealMs + 17)
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

/** One frame as the director draws it, after posing the cast: game time and the ball. */
type CastFrame = { nowMs: number; view: BallView; run: StageRun }

/** The keyboard swing at a pitch released among `events`, `offsetsMs[pitch]` off PERFECT, or null to let it go. */
function swingAtRelease(run: StageRun, events: StageEvent[], offsetsMs: (number | null)[]): RealTimeSwing | null {
  const release = events.find((event) => event.type === 'release')
  const offsetMs = release?.type === 'release' ? offsetsMs[release.pitchIndex] : null
  if (release?.type !== 'release' || offsetMs === null) return null
  const atGameMs = release.releasedMs + contactSeconds(release.pitch) * 1000 + offsetMs
  const atMs = run.clock.realMs + (atGameMs - run.clock.gameMs) / run.clock.rate
  return { source: 'keyboard', contactAtRealMs: atMs, startedAtRealMs: atMs, speed: 0, batHeight: null }
}

/**
 * Plays a normal keyboard run on `side` with `cast` the way the director does, a frame every FRAME_MS: each pitch swung
 * `offsetsMs` off PERFECT (null: let go), handed in with the next frame, the heads eased `delta` seconds a frame.
 */
function playWithCast(
  cast: BallplayerCast,
  side: BattingSide,
  offsetsMs: (number | null)[],
  watch: (frame: CastFrame) => void,
  delta = FRAME_MS / 1000,
) {
  const plan = createRunPlan({ pitchCount: offsetsMs.length, difficulty: 'normal' }, 7)
  const run = createStageRun({ plan, log: { input: 'keyboard', side, practice: [] } }, 0)
  let pending: RealTimeSwing | null = null
  for (let realMs = FRAME_MS; run.derby.phase !== 'finished'; realMs += FRAME_MS) {
    const handedIn: RealTimeSwing[] = pending && pending.contactAtRealMs < realMs ? [pending] : []
    pending = handedIn.length > 0 ? null : pending
    const events = playStageFrame(run, handedIn, realMs, false)
    pending = pending ?? swingAtRelease(run, events, offsetsMs)
    const nowMs = gameTime(run.clock, realMs)
    const view = stageBallView(run, nowMs, posePitcherAt(cast, run, nowMs))
    posePlayers(cast, run, nowMs, view, delta)
    watch({ nowMs, view, run })
  }
}

describe('ballplayer cast', () => {
  it('swings the batter so its bat meets each ball in play where and when the stage sends it off', () => {
    const sides: BattingSide[] = ['right', 'left']
    const misses = sides.flatMap((side) => {
      const cast = createCast(createBatter(DEFAULT_PLAYER_PROFILE, side), createFielders())
      return [-120, 0, 100].map((offsetMs) => batMissesBall(cast, swungRun(side, offsetMs).run))
    })
    expect(Math.max(...misses)).toBeLessThan(0.002)
  })

  it('swings the batter through the contact point at the moment of a swing that misses', () => {
    const cast = createCast(createBatter(DEFAULT_PLAYER_PROFILE, 'right'), createFielders())
    const { run, contactAtMs } = swungRun('right', 200)
    cueBatter(cast, run)
    expect(run.derby.results[0].outcome).toBe('miss')
    const contactPoint = new Vector3(CONTACT_POINT.x, CONTACT_POINT.y, CONTACT_POINT.z)
    expect(sweetSpotAt(cast, run, contactAtMs).distanceTo(contactPoint)).toBeLessThan(0.002)
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
      turnHead(batter.rig, pose.headYaw, pose.headPitch)
      offKeyed.push(posed.angleTo(keyed.copy(batter.rig.head.quaternion)))
    }
    playWithCast(cast, 'left', [0], watch, 10)
    expect(offKeyed.length).toBeGreaterThan(10)
    expect(Math.max(...offKeyed)).toBeLessThan(1e-6)
    expect(fieldersOffBall.length).toBeGreaterThan(5)
    expect(Math.max(...fieldersOffBall)).toBeLessThan(0.5)
  })

  it('keeps the bat out of the batter’s head as it watches a pitch into the mitt and a home run into the stands', () => {
    const looks: Partial<PlayerProfile>[] = [
      { hat: 'cap', hair: 'crop' },
      { hat: 'beanie', hair: 'bob' },
      { hat: 'sunhat', hair: 'crop' },
      { hat: 'none', hair: 'bob', ears: 'pointed' },
    ]
    const sides: BattingSide[] = ['right', 'left']
    const deepest = sides.flatMap((side) =>
      looks.map((look) => {
        const cast = createCast(createBatter({ ...DEFAULT_PLAYER_PROFILE, ...look }, side), createFielders())
        let depth = 0
        playWithCast(cast, side, [null, 0, null], () => {
          depth = Math.max(depth, batInHead(cast.batter) * PLAYER_SCALE)
        })
        return depth
      }),
    )
    expect(Math.max(...deepest)).toBeLessThan(0.005)
  })
})
