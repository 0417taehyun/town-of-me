import type { Vec3 } from '../../data/models'
import type { Landing } from './landing'

// The batted ball as drawn: gravity and drag in fixed steps, aimed to come down where landing.ts already decided.
// Display only; no score reads it, so it may use trigonometry. Fixed steps land the drawn ball in the same place at
// any frame rate.

export const GRAVITY = 9.8
/** Drag slows the ball by DRAG × speed² m/s². */
export const DRAG = 0.0035
export const FLIGHT_STEP_SECONDS = 1 / 120
/** The ball's center when it rests on the grass. */
export const BALL_REST_HEIGHT = 0.04
/** About 33 s of flight, far longer than any ball stays up. */
export const MAX_FLIGHT_STEPS = 4000
/** The top of the launch speed search (m/s); the longest home run needs well under it. */
export const MAX_LAUNCH_SPEED = 150

export type BallFlight = {
  position: Vec3
  velocity: Vec3
  /** Seconds of flight stepped so far. */
  elapsed: number
  /** Frame time not yet stepped, always under one step. */
  pendingSeconds: number
  landed: boolean
}

export function createFlight(start: Vec3, velocity: Vec3): BallFlight {
  return { position: { ...start }, velocity: { ...velocity }, elapsed: 0, pendingSeconds: 0, landed: false }
}

/** The ground point `distance` m from home plate at spray angle `spray`. */
export function sprayPoint(spray: number, distance: number) {
  return { x: Math.sin(spray) * distance, z: -Math.cos(spray) * distance }
}

/** Advances the drawn flight by `seconds` of game time in whole fixed steps, carrying the rest to the next frame. */
export function stepFlight(flight: BallFlight, seconds: number) {
  flight.pendingSeconds += seconds
  while (!flight.landed && flight.pendingSeconds >= FLIGHT_STEP_SECONDS) {
    integrateFlight(flight)
    flight.pendingSeconds -= FLIGHT_STEP_SECONDS
  }
  return flight
}

/** One fixed step. The step that reaches the grass ends where the ball crossed rest height, not below it. */
export function integrateFlight(flight: BallFlight) {
  const { position, velocity } = flight
  const before = { ...position }
  const slowing = DRAG * Math.hypot(velocity.x, velocity.y, velocity.z) * FLIGHT_STEP_SECONDS
  velocity.x -= slowing * velocity.x
  velocity.y -= slowing * velocity.y + GRAVITY * FLIGHT_STEP_SECONDS
  velocity.z -= slowing * velocity.z
  position.x += velocity.x * FLIGHT_STEP_SECONDS
  position.y += velocity.y * FLIGHT_STEP_SECONDS
  position.z += velocity.z * FLIGHT_STEP_SECONDS
  flight.elapsed += FLIGHT_STEP_SECONDS
  if (position.y > BALL_REST_HEIGHT || velocity.y >= 0) return
  const fraction = (before.y - BALL_REST_HEIGHT) / (before.y - position.y)
  position.x = before.x + (position.x - before.x) * fraction
  position.z = before.z + (position.z - before.z) * fraction
  position.y = BALL_REST_HEIGHT
  flight.landed = true
}

/** Flies a copy to the grass, so the stage knows where and when the ball comes down before it does. */
export function predictLanding(start: Vec3, velocity: Vec3) {
  const flight = createFlight(start, velocity)
  for (let step = 0; step < MAX_FLIGHT_STEPS && !flight.landed; step += 1) integrateFlight(flight)
  return { x: flight.position.x, z: flight.position.z, hangSeconds: flight.elapsed }
}

/**
 * The velocity that sends a ball in play from `start` (where the bat met it) to its landing spot at the landing's
 * launch angle. Drag keeps a flight in the vertical plane it starts in, so only the speed is searched, by bisection:
 * a faster ball always carries farther.
 */
export function launchForLanding(landing: Landing, start: Vec3): Vec3 {
  const spot = sprayPoint(landing.spray, landing.distanceDecimetres / 10)
  const across = spot.x - start.x
  const along = spot.z - start.z
  const range = Math.hypot(across, along)
  const launch = (landing.launchDegrees * Math.PI) / 180
  const direction = {
    x: (across / range) * Math.cos(launch),
    y: Math.sin(launch),
    z: (along / range) * Math.cos(launch),
  }
  let slowest = 0
  let fastest = MAX_LAUNCH_SPEED
  for (let halving = 0; halving < 40; halving += 1) {
    const speed = (slowest + fastest) / 2
    const short = carryFrom(start, scaled(direction, speed)) < range
    slowest = short ? speed : slowest
    fastest = short ? fastest : speed
  }
  return scaled(direction, (slowest + fastest) / 2)
}

/** How far along the ground (m) a ball launched from `start` at `velocity` comes down from where it started. */
export function carryFrom(start: Vec3, velocity: Vec3) {
  const landed = predictLanding(start, velocity)
  return Math.hypot(landed.x - start.x, landed.z - start.z)
}

export function scaled(direction: Vec3, length: number): Vec3 {
  return { x: direction.x * length, y: direction.y * length, z: direction.z * length }
}
