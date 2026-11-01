import type { PlayerProfile } from '../../data/playerProfile'
import { damp } from '../../motionMath'
import { sprayPoint } from '../game/flight'
import { gameTime } from '../game/gameClock'
import type { BallView } from '../stage/ballMeshes'
import { disposeBallplayerRig } from '../stage/actors/ballplayerRig'
import {
  createFieldPlayer,
  type FieldPlayer,
  type FieldPose,
  poseFieldPlayer,
  STANDING,
} from '../stage/actors/fieldPlayer'
import { type HeadRange, watch } from '../stage/actors/headLook'
import { batchRigs, disposeRigBatch, drawRigBatch, type RigBatch } from '../stage/actors/rigBatch'
import { AWAY_UNIFORM, HOME_UNIFORM, UMPIRE_UNIFORM, wearUniform } from '../stage/actors/teamUniforms'
import type { StageRun } from '../stage/stageRun'
import {
  createMover,
  DUGOUT_FLOOR,
  FIELDER_SPOTS,
  headingToward,
  type Mover,
  OUR_DUGOUT,
  RUNNER_SPOT,
  sendChase,
  sendHome,
  type Spot,
  stepMover,
  teammateSpots,
  UMPIRE_SPOT,
} from './fielderLayout'
import { pickLooks } from './guestLooks'

// The rest of the field around the play (fielderLayout.ts): the other team's seven fielders in brick red and charcoal,
// the plate umpire, our runner on second, and our teammates at the rail of our dugout in cream and navy. All of them
// watch the ball; the fielders crouch ready for each pitch and run for a ball in play, our side cheers a hit or a home
// run, and the fielders slump at one. The rigs draw as one batch (rigBatch.ts).

/** Someone on the field: his rig, where he is and is going, the floor he stands on, and his pose as last eased. */
export type CrewMember = { player: FieldPlayer; mover: Mover; floor: number; pose: FieldPose }

/** How each kind of player feels about the latest result, and how low each crouches for a pitch. */
export type CrewMood = { crouch: number; slump: number; cheer: number }

export type FieldCrew = {
  fielders: CrewMember[]
  umpire: CrewMember
  runner: CrewMember
  teammates: CrewMember[]
  everyone: CrewMember[]
  batch: RigBatch
  /** The run the orders below were for, the pitch whose ball was last chased and the last sent back for, in game ms. */
  run: StageRun | null
  chasedPitch: number
  homeFor: number
  lastGameMs: number | null
}

/** How far each head turns (degrees in its rig frame). */
export const CREW_HEAD_RANGE: HeadRange = { yaw: [-90, 90], pitch: [-60, 50] }
/** How fast (per second) a pose eases, a cheering player hops (m) and waves (radians a second). */
export const CREW_MOTION = { ease: 6, runEase: 10, hop: 0.25, wave: 12 }

const HOME_PLATE: Spot = { x: 0, z: 0 }

export function crewMember(look: PlayerProfile, gloved: boolean, home: Spot, heading: number, floor = 0): CrewMember {
  return { player: createFieldPlayer(look, gloved), mover: createMover(home, heading), floor, pose: { ...STANDING } }
}

/**
 * The crew in looks from the `approved` guestbook looks, padded with random ones; our teammates only `withTeammates`,
 * which a reduced performance tier leaves out (they are off the batting shot anyway).
 */
export function createFieldCrew(approved: readonly PlayerProfile[], withTeammates: boolean): FieldCrew {
  const looks = pickLooks(approved, FIELDER_SPOTS.length + 6, 29)
  const fielders = FIELDER_SPOTS.map((spot, index) =>
    crewMember(wearUniform(looks[index], AWAY_UNIFORM), true, spot, headingToward(spot, HOME_PLATE)),
  )
  const ours = looks.slice(FIELDER_SPOTS.length)
  const runner = crewMember(
    wearUniform(ours[0], HOME_UNIFORM),
    false,
    RUNNER_SPOT,
    headingToward(RUNNER_SPOT, HOME_PLATE),
  )
  const umpire = crewMember(wearUniform(ours[1], UMPIRE_UNIFORM), false, UMPIRE_SPOT, Math.PI)
  const teammates = (withTeammates ? teammateSpots() : []).map((spot, index) =>
    crewMember(wearUniform(ours[2 + index], HOME_UNIFORM), false, spot, OUR_DUGOUT.yaw, DUGOUT_FLOOR),
  )
  const everyone = [...fielders, umpire, runner, ...teammates]
  everyone.forEach((member) => placeMember(member, 0))
  const batch = batchRigs(everyone.map((member) => member.player.rig.root))
  return {
    fielders,
    umpire,
    runner,
    teammates,
    everyone,
    batch,
    run: null,
    chasedPitch: -1,
    homeFor: -1,
    lastGameMs: null,
  }
}

export function disposeFieldCrew(crew: FieldCrew) {
  crew.everyone.forEach((member) => disposeBallplayerRig(member.player.rig))
  disposeRigBatch(crew.batch)
}

/**
 * Orders the fielders for `run`: the nearest runs for a ball in play once it flies, the next backs him up, and every
 * one goes back to his spot at the next windup. A new run starts the orders afresh.
 */
export function directCrew(crew: FieldCrew, run: StageRun | null) {
  if (crew.run !== run) Object.assign(crew, { run, chasedPitch: -1, homeFor: -1, lastGameMs: null })
  const movers = crew.fielders.map((member) => member.mover)
  const batted = run?.batted
  if (batted?.flight && batted.pitchIndex !== crew.chasedPitch) {
    crew.chasedPitch = batted.pitchIndex
    sendChase(movers, sprayPoint(batted.landing.spray, batted.landing.distanceDecimetres / 10))
  }
  const pitchIndex = run?.derby.pitchIndex ?? -1
  if (run?.derby.phase !== 'windup' || crew.homeFor === pitchIndex) return
  crew.homeFor = pitchIndex
  sendHome(movers)
}

/** Game seconds since the crew's last frame, at the run's pace (slow motion slows the runners); `delta` with no run. */
export function crewSeconds(crew: FieldCrew, run: StageRun | null, realMs: number, delta: number) {
  if (!run) return delta
  const nowMs = gameTime(run.clock, realMs)
  const seconds = crew.lastGameMs === null ? 0 : Math.max(0, nowMs - crew.lastGameMs) / 1000
  crew.lastGameMs = nowMs
  return seconds
}

/** The moods for the latest result in `run`, and for a pitch on its way. */
export function crewMoods(run: StageRun | null) {
  const phase = run?.derby.phase
  const latest = phase === 'result' ? run?.derby.results.at(-1)?.outcome : undefined
  const ready = phase === 'windup' || phase === 'pitch' ? 1 : 0
  const ourJoy = latest === 'homeRun' ? 1 : latest === 'hit' ? 0.7 : 0
  return {
    fielder: { crouch: ready, slump: latest === 'homeRun' ? 1 : 0, cheer: 0 },
    umpire: { crouch: 0.7 * ready, slump: 0, cheer: 0 },
    runner: { crouch: 0.45 * ready, slump: 0, cheer: ourJoy },
    teammate: { crouch: 0, slump: 0, cheer: ourJoy },
  } satisfies Record<string, CrewMood>
}

/**
 * Moves and poses everyone for this frame: `seconds` of game time to run (crewSeconds), `delta` real seconds to ease,
 * every head toward `view`'s ball while one is in sight; under `reducedMotion` nobody hops or waves.
 */
export function playFieldCrew(
  crew: FieldCrew,
  run: StageRun | null,
  view: BallView | null,
  seconds: number,
  delta: number,
  reducedMotion: boolean,
) {
  directCrew(crew, run)
  const moods = crewMoods(run)
  const sight = view?.visible ? view.position : null
  const motion = reducedMotion ? 0 : delta
  crew.fielders.forEach((member) => playMember(member, moods.fielder, sight, seconds, delta, motion))
  playMember(crew.umpire, moods.umpire, sight, seconds, delta, motion)
  playMember(crew.runner, moods.runner, sight, seconds, delta, motion)
  crew.teammates.forEach((member) => playMember(member, moods.teammate, sight, seconds, delta, motion))
  drawRigBatch(
    crew.batch,
    crew.everyone.map((member) => member.player.rig.root),
  )
}

/** Runs, eases, and poses one member, facing the ball in `sight` (else home plate) and turning his head toward it. */
export function playMember(
  member: CrewMember,
  mood: CrewMood,
  sight: BallView['position'] | null,
  seconds: number,
  delta: number,
  motion: number,
) {
  const { mover, pose, player } = member
  const running = stepMover(mover, seconds, sight ?? HOME_PLATE, delta)
  pose.crouch = damp(pose.crouch, running ? 0 : mood.crouch, CREW_MOTION.ease, delta)
  pose.slump = damp(pose.slump, running ? 0 : mood.slump, CREW_MOTION.ease, delta)
  pose.cheer = damp(pose.cheer, mood.cheer, CREW_MOTION.ease, delta)
  pose.run = damp(pose.run, running ? Math.min(1, mover.speed / 6) : 0, CREW_MOTION.runEase, delta)
  pose.stride = mover.stride
  pose.wave += motion * CREW_MOTION.wave
  placeMember(member, Math.max(0, Math.sin(pose.wave * 0.9)) * CREW_MOTION.hop * pose.cheer * (motion > 0 ? 1 : 0))
  poseFieldPlayer(player, pose)
  if (sight) watch(player.rig, player.look, sight, CREW_HEAD_RANGE, delta)
}

export function placeMember({ player, mover, floor }: CrewMember, hop: number) {
  player.rig.root.position.set(mover.x, floor + hop, mover.z)
  player.rig.root.rotation.y = mover.heading
}
