import { Vector3 } from 'three'
import { clamp, dampAngle } from '../../motionMath'
import { BASE_DISTANCE, BASES, fenceDistance, FOUL_ANGLE } from '../game/field'
import { sprayPoint } from '../game/flight'
import { CATCHER_SPOT } from '../stage/stageLayout'
import { DUGOUT_SPOTS } from './fieldLayout'

// Where everyone on the field besides the batter, the pitcher, and the catcher stands, and how they move: the other
// team's seven fielders run for a ball in play, the nearest taking it and the next backing him up, and jog back for the
// next pitch. They only show where the derby already sent the ball; nothing here changes a result.

/** A point on the field (meters). */
export type Spot = { x: number; z: number }

/** First and second base, shortstop, third base, then left, center, and right field, while a pitch is on its way. */
export const FIELDER_SPOTS: readonly Spot[] = [
  { x: 21.5, z: -23.5 },
  { x: 9, z: -33.5 },
  { x: -9, z: -33.5 },
  { x: -21.5, z: -23.5 },
  { x: -30, z: -58 },
  { x: 0, z: -70 },
  { x: 30, z: -58 },
]

/** How far toward third our runner leads off second, as a share of the base path. */
export const RUNNER_LEAD = 3.5 / BASE_DISTANCE

/** The plate umpire, behind the catcher and under the batting shot's view (cameraShots.ts BATTING_EYE). */
export const UMPIRE_SPOT: Spot = { x: 0, z: CATCHER_SPOT.z + 1.4 }

/**
 * Our runner, leading off second base 3.5 m toward third and a step behind the base path: wide enough of the pitcher on
 * the batting shot that he never stands where the ball leaves the hand.
 */
export const RUNNER_SPOT: Spot = {
  x: BASES.second.x + (BASES.third.x - BASES.second.x) * RUNNER_LEAD - Math.SQRT1_2,
  z: BASES.second.z + (BASES.third.z - BASES.second.z) * RUNNER_LEAD - Math.SQRT1_2,
}

/** Our dugout, on the third-base side, and where our teammates stand at its rail (shed space, +z toward the field). */
export const OUR_DUGOUT = DUGOUT_SPOTS[0]
export const TEAMMATE_PLACES = [-2.7, -0.9, 0.9, 2.7].map((across) => ({ across, ahead: 0.9 }))
/** The dugout's floor height. */
export const DUGOUT_FLOOR = 0.25

/** Run speeds (m per game second): the fielder taking the ball, the one backing him up, and back to their spots. */
export const CREW_SPEEDS = { chase: 7.2, backUp: 5, home: 8 }

/** A chase ends this far inside the hedge, and this far (radians) inside the foul lines. */
export const CHASE_LIMITS = { fence: 1.4, foulLine: 0.03 }

/** How close (m) a runner must come to where he is going to stop, and how fast (per second) he turns. */
export const ARRIVAL = { distance: 0.05, turnRate: 9 }

/** Our teammates' spots in the field: along the rail of our dugout, facing the field. */
export function teammateSpots(): Spot[] {
  const turn = new Vector3()
  return TEAMMATE_PLACES.map(({ across, ahead }) => {
    turn.set(across, 0, ahead).applyAxisAngle(new Vector3(0, 1, 0), OUR_DUGOUT.yaw)
    return { x: OUR_DUGOUT.x + turn.x, z: OUR_DUGOUT.z + turn.z }
  })
}

/** Where a fielder can run for a ball coming down at `landing`: in fair territory, inside the hedge. */
export function reachableSpot(landing: Spot): Spot {
  const limit = FOUL_ANGLE - CHASE_LIMITS.foulLine
  const spray = clamp(Math.atan2(landing.x, -landing.z), -limit, limit)
  const distance = Math.min(Math.hypot(landing.x, landing.z), fenceDistance(spray) - CHASE_LIMITS.fence)
  return sprayPoint(spray, distance)
}

/** The indices of `spots`, nearest to `target` first. */
export function nearestFirst(spots: readonly Spot[], target: Spot) {
  const away = spots.map((spot) => Math.hypot(spot.x - target.x, spot.z - target.z))
  return away.map((_, index) => index).sort((first, second) => away[first] - away[second])
}

/**
 * Someone on the field: where he is, where he belongs, where he is running (null standing), how fast, which way he
 * faces (radians, from +z toward +x), and how far through his stride he is (radians).
 */
export type Mover = {
  x: number
  z: number
  home: Spot
  target: Spot | null
  speed: number
  heading: number
  stride: number
}

export function createMover(home: Spot, heading: number): Mover {
  return { x: home.x, z: home.z, home, target: null, speed: 0, heading, stride: 0 }
}

export function runTo(mover: Mover, target: Spot, speed: number) {
  mover.target = target
  mover.speed = speed
}

/** Sends the fielder nearest the reachable spot for `landing` there, and the next nearest halfway to back him up. */
export function sendChase(fielders: readonly Mover[], landing: Spot) {
  const spot = reachableSpot(landing)
  const [chaser, backUp] = nearestFirst(fielders, spot)
  const backer = fielders[backUp]
  runTo(fielders[chaser], spot, CREW_SPEEDS.chase)
  if (backer) runTo(backer, { x: (backer.x + spot.x) / 2, z: (backer.z + spot.z) / 2 }, CREW_SPEEDS.backUp)
}

export function sendHome(movers: readonly Mover[]) {
  movers.forEach((mover) => runTo(mover, mover.home, CREW_SPEEDS.home))
}

/** The heading from `from` toward `to`. */
export function headingToward(from: Spot, to: Spot) {
  return Math.atan2(to.x - from.x, to.z - from.z)
}

/**
 * Runs `mover` `seconds` (game time) toward his target, facing his way, and stops him there; a mover standing turns
 * toward `watched` over `delta` seconds. Returns whether he is running.
 */
export function stepMover(mover: Mover, seconds: number, watched: Spot, delta: number) {
  const target = mover.target
  const away = target ? Math.hypot(target.x - mover.x, target.z - mover.z) : 0
  const step = Math.min(away, mover.speed * seconds)
  const running = target !== null && away > ARRIVAL.distance
  if (target && running) {
    mover.x += ((target.x - mover.x) / away) * step
    mover.z += ((target.z - mover.z) / away) * step
  }
  if (!running) mover.target = null
  const facing = running && target ? headingToward(mover, target) : headingToward(mover, watched)
  mover.heading = dampAngle(mover.heading, facing, ARRIVAL.turnRate, delta)
  mover.stride += running ? step * 2.1 : 0
  return running
}
