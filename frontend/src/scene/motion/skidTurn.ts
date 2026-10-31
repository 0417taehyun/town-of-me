import { smoothPlayerVelocity } from './playerMotion'
import { blendPose, copyPose, createRestPose, type CharacterPose } from './walkCycle'
import { clamp, damp, dampAngle, smoothstep, wrapAngle } from '../../motionMath'

// Turning back at a run, the player turns to face the new way over 0.3 s while sliding on backwards for 0.42 s, leaning
// into the new direction with arms windmilling, then sets off (or stops there if the input is gone), as in Animal
// Crossing. Letting go at a run brakes facing ahead, leaning back on a braced front leg.
const SKID = {
  minSpeed: 6,
  launch: 0.45,
  settleSeconds: 0.46,
  settleSwing: 0.22,
}

/** How the player turns back at a run, chosen per town by the admin. */
export const SKID_STYLES = ['long', 'short', 'off'] as const
export type SkidStyle = (typeof SKID_STYLES)[number]

const skidTimings = {
  // Turns slowly enough to read as the face turning round, and finishes before the slide ends.
  long: { turnSeconds: 0.3, slideSeconds: 0.42, brakeSeconds: 0.45 },
  short: { turnSeconds: 0.2, slideSeconds: 0.24, brakeSeconds: 0.28 },
  // `off` never starts a slide; switching to it mid-slide ends the slide at once.
  off: { turnSeconds: 0.2, slideSeconds: 0, brakeSeconds: 0 },
} satisfies Record<SkidStyle, { turnSeconds: number; slideSeconds: number; brakeSeconds: number }>

type Brace = Record<
  'bracedLeg' | 'bracedKnee' | 'bracedFoot' | 'freeLeg' | 'freeKnee' | 'freeFoot' | 'pitch' | 'bodyZ' | 'head',
  number
>

/** Sliding backwards after the turn: the braced leg reaches back toward the slide and the body leans the new way. */
const TURNED_BRACE: Brace = {
  bracedLeg: 0.66,
  bracedKnee: 0.12,
  bracedFoot: 0.25,
  freeLeg: -0.38,
  freeKnee: 1.05,
  freeFoot: 0,
  pitch: 0.3,
  bodyZ: 0.06,
  head: -0.1,
}

/** Braking ahead: the braced leg plants in front and the body leans back against the slide. */
const BRAKE_BRACE: Brace = {
  bracedLeg: -0.8,
  bracedKnee: 0.05,
  bracedFoot: -0.55,
  freeLeg: 0.18,
  freeKnee: 1.25,
  freeFoot: 0.1,
  pitch: -0.44,
  bodyZ: -0.07,
  head: 0.2,
}

/** Dust puffs, and skid marks on paths and snow, every this many meters of slide. */
export const SKID_DUST_SPACING = 0.075
/** How far along the slide from the body the braced foot plants. */
export const SKID_FOOT_AHEAD = 0.36
const TURN_BACK_COSINE = Math.cos((120 * Math.PI) / 180)
const GRAVITY = 9.8

export type PlanarVector = { x: number; z: number }
export type MovementMode = 'move' | 'skid' | 'brake' | 'settle'
export type MovementEvent = { type: 'skid' | 'brake' | 'launch' | 'settle'; speed: number; quiet?: boolean }

export type PlayerMovement = {
  style: SkidStyle
  mode: MovementMode
  /** Seconds in the current mode. */
  elapsed: number
  velocity: PlanarVector
  previousVelocity: PlanarVector
  slideSpeed: number
  slideDirection: PlanarVector
  wantedDirection: PlanarVector
  yaw: number
  turnFrom: number
  turnBy: number
  /** When in the slide the turn to the new direction began. */
  turnStartedAt: number
  runningFor: number
  leanPitch: number
  leanRoll: number
  settlePitch: number
  skidWeight: number
  /** The leg that is ahead right now, reported by the character every frame. */
  leadingLeg: -1 | 1
  /** The leg planted for the whole slide, taken from `leadingLeg` when it starts. */
  bracedLeg: -1 | 1
  /** Whether the slide turned to face the new way, rather than braking ahead; it shapes the brace until it fades. */
  turnedSlide: boolean
  /** What happened this frame, for sound and dust; the caller clears it. */
  events: MovementEvent[]
}

export function createPlayerMovement(yaw = 0, style: SkidStyle = 'long'): PlayerMovement {
  return {
    style,
    mode: 'move',
    elapsed: 0,
    velocity: { x: 0, z: 0 },
    previousVelocity: { x: 0, z: 0 },
    slideSpeed: 0,
    slideDirection: { x: 0, z: 1 },
    wantedDirection: { x: 0, z: 1 },
    yaw,
    turnFrom: yaw,
    turnBy: 0,
    turnStartedAt: 0,
    runningFor: 0,
    leanPitch: 0,
    leanRoll: 0,
    settlePitch: 0,
    skidWeight: 0,
    leadingLeg: 1,
    bracedLeg: 1,
    turnedSlide: false,
    events: [],
  }
}

type MovementInput = { x: number; z: number; active: boolean }

export function lengthOf({ x, z }: PlanarVector) {
  return Math.hypot(x, z)
}

export function setDirection(target: PlanarVector, x: number, z: number) {
  const length = Math.hypot(x, z) || 1
  target.x = x / length
  target.z = z / length
}

/** A turn of almost half a circle always goes the same way round, so it never wobbles between sides. */
export function getTurnTo(yaw: number, direction: PlanarVector) {
  const turn = wrapAngle(Math.atan2(direction.x, direction.z) - yaw)
  return Math.abs(turn) > Math.PI - 0.12 ? Math.PI : turn
}

export function startTurn(movement: PlayerMovement) {
  movement.turnFrom = movement.yaw
  movement.turnBy = getTurnTo(movement.yaw, movement.wantedDirection)
  movement.turnStartedAt = movement.elapsed
}

export function startSlide(movement: PlayerMovement, mode: 'skid' | 'brake', input: MovementInput) {
  movement.mode = mode
  movement.elapsed = 0
  movement.slideSpeed = lengthOf(movement.velocity)
  setDirection(movement.slideDirection, movement.velocity.x, movement.velocity.z)
  setDirection(movement.wantedDirection, input.x, input.z)
  movement.bracedLeg = movement.leadingLeg
  movement.turnedSlide = mode === 'skid'
  startTurn(movement)
  movement.events.push({ type: mode, speed: movement.slideSpeed })
}

export function maybeStartSlide(movement: PlayerMovement, input: MovementInput) {
  const speed = lengthOf(movement.velocity)
  if (speed <= SKID.minSpeed || movement.style === 'off') return
  if (!input.active && movement.runningFor > 0.15) return startSlide(movement, 'brake', input)
  if (!input.active) return
  const along = (input.x * movement.velocity.x + input.z * movement.velocity.z) / (lengthOf(input) * speed)
  if (along < TURN_BACK_COSINE) startSlide(movement, 'skid', input)
}

/** The feet grip as the slide runs out, so speed falls evenly to zero over `seconds`. */
export function slide(movement: PlayerMovement, seconds: number) {
  const speed = movement.slideSpeed * Math.max(0, 1 - movement.elapsed / seconds)
  movement.velocity.x = movement.slideDirection.x * speed
  movement.velocity.z = movement.slideDirection.z * speed
}

export function holdBrace(movement: PlayerMovement, delta: number) {
  movement.leanPitch = damp(movement.leanPitch, 0, 12, delta)
  movement.leanRoll = damp(movement.leanRoll, 0, 12, delta)
  movement.skidWeight = damp(movement.skidWeight, 1, 30, delta)
}

export function startSettling(movement: PlayerMovement) {
  movement.mode = 'settle'
  movement.elapsed = 0
  movement.velocity.x = 0
  movement.velocity.z = 0
  movement.events.push({ type: 'settle', speed: 0 })
}

/** Leans forward when speeding up, back when slowing, and into a curve, like a body balancing on its feet. */
export function leanWithAcceleration(movement: PlayerMovement, delta: number) {
  const accelerationX = (movement.velocity.x - movement.previousVelocity.x) / delta
  const accelerationZ = (movement.velocity.z - movement.previousVelocity.z) / delta
  const forwardX = Math.sin(movement.yaw)
  const forwardZ = Math.cos(movement.yaw)
  const forward = accelerationX * forwardX + accelerationZ * forwardZ
  const sideways = accelerationX * forwardZ - accelerationZ * forwardX
  const pitch = clamp(0.45 * Math.atan2(forward, GRAVITY), -0.3, 0.3)
  const roll = clamp(-0.5 * Math.atan2(sideways, GRAVITY), -0.28, 0.28)
  movement.leanPitch = damp(movement.leanPitch, pitch, 9, delta)
  movement.leanRoll = damp(movement.leanRoll, roll, 9, delta)
}

export function resumeFromBrake(movement: PlayerMovement, input: MovementInput) {
  setDirection(movement.wantedDirection, input.x, input.z)
  const along =
    movement.wantedDirection.x * movement.slideDirection.x + movement.wantedDirection.z * movement.slideDirection.z
  if (along >= TURN_BACK_COSINE) {
    movement.mode = 'move'
    return
  }
  // A keyboard reversal passes through a frame with no key held, which already braked and squealed.
  movement.mode = 'skid'
  movement.turnedSlide = true
  movement.elapsed = Math.min(movement.elapsed, skidTimings[movement.style].slideSeconds * 0.6)
  startTurn(movement)
  movement.events.push({ type: 'skid', speed: movement.slideSpeed, quiet: true })
}

const modeSteps: Record<
  MovementMode,
  (movement: PlayerMovement, input: MovementInput, targetSpeed: number, delta: number) => void
> = {
  move(movement, input, targetSpeed, delta) {
    const { velocity } = movement
    smoothPlayerVelocity(velocity.x, velocity.z, input.x * targetSpeed, input.z * targetSpeed, delta, velocity)
    const speed = lengthOf(velocity)
    const facing = speed > 0.8 ? velocity : input
    if (speed > 0.8 || input.active)
      movement.yaw = dampAngle(movement.yaw, Math.atan2(facing.x, facing.z), speed > 0.8 ? 12 : 16, delta)
    leanWithAcceleration(movement, delta)
    movement.skidWeight = damp(movement.skidWeight, 0, 25, delta)
  },
  skid(movement, input, targetSpeed, delta) {
    const { slideSeconds, turnSeconds } = skidTimings[movement.style]
    movement.elapsed += delta
    slide(movement, slideSeconds)
    holdBrace(movement, delta)
    if (input.active) setDirection(movement.wantedDirection, input.x, input.z)
    const turned = Math.min(1, (movement.elapsed - movement.turnStartedAt) / turnSeconds)
    movement.yaw = movement.turnFrom + movement.turnBy * smoothstep(turned)
    if (movement.elapsed < slideSeconds) return
    if (!input.active) return startSettling(movement)
    movement.mode = 'move'
    const launch = SKID.launch * targetSpeed
    movement.velocity.x = movement.wantedDirection.x * launch
    movement.velocity.z = movement.wantedDirection.z * launch
    movement.events.push({ type: 'launch', speed: launch })
  },
  brake(movement, input, _targetSpeed, delta) {
    const { brakeSeconds } = skidTimings[movement.style]
    movement.elapsed += delta
    slide(movement, brakeSeconds)
    holdBrace(movement, delta)
    if (input.active) return resumeFromBrake(movement, input)
    if (movement.elapsed >= brakeSeconds) startSettling(movement)
  },
  settle(movement, input, _targetSpeed, delta) {
    movement.elapsed += delta
    movement.skidWeight = damp(movement.skidWeight, 0, 18, delta)
    // The body rocks forward past upright once and settles, like catching its balance after stopping.
    movement.settlePitch =
      SKID.settleSwing * Math.exp(-movement.elapsed / 0.13) * Math.sin((Math.PI * movement.elapsed) / 0.17)
    if (input.active || movement.elapsed >= SKID.settleSeconds) movement.mode = 'move'
  },
}

/**
 * One frame of the player's own movement. `direction` is the camera-relative input (length up to 1), `measured` the
 * physics body's velocity, so walls still stop the player; afterwards `velocity` and `yaw` are what to apply.
 */
export function stepPlayerMovement(
  movement: PlayerMovement,
  direction: PlanarVector,
  targetSpeed: number,
  delta: number,
  measured: PlanarVector,
) {
  if (delta <= 0) return movement
  const length = lengthOf(direction)
  const scale = length > 1 ? 1 / length : 1
  const input = { x: direction.x * scale, z: direction.z * scale, active: length >= 0.2 }
  movement.previousVelocity.x = movement.velocity.x
  movement.previousVelocity.z = movement.velocity.z
  movement.velocity.x = measured.x
  movement.velocity.z = measured.z
  if (movement.mode === 'move') maybeStartSlide(movement, input)
  modeSteps[movement.mode](movement, input, targetSpeed, delta)
  if (movement.mode !== 'settle') movement.settlePitch = damp(movement.settlePitch, 0, 10, delta)
  movement.runningFor = lengthOf(movement.velocity) > SKID.minSpeed ? movement.runningFor + delta : 0
  return movement
}

const restingPose = createRestPose()
const bracePose = createRestPose()

/** The braced slide pose, with both arms windmilling for balance. */
export function setBracePose(pose: CharacterPose, movement: PlayerMovement) {
  const brace = movement.turnedSlide ? TURNED_BRACE : BRAKE_BRACE
  const leftBraced = movement.bracedLeg < 0
  const windmill = Math.sin(movement.elapsed * 24)
  copyPose(pose, restingPose)
  pose.leftLeg = leftBraced ? brace.bracedLeg : brace.freeLeg
  pose.rightLeg = leftBraced ? brace.freeLeg : brace.bracedLeg
  pose.leftKnee = leftBraced ? brace.bracedKnee : brace.freeKnee
  pose.rightKnee = leftBraced ? brace.freeKnee : brace.bracedKnee
  pose.leftFoot = leftBraced ? brace.bracedFoot : brace.freeFoot
  pose.rightFoot = leftBraced ? brace.freeFoot : brace.bracedFoot
  pose.leftLegSpread = -0.07
  pose.rightLegSpread = 0.07
  pose.pitch = brace.pitch
  pose.bodyZ = brace.bodyZ
  pose.headPitch = brace.head
  pose.leftArm = -1.5 + 0.55 * windmill
  pose.rightArm = -1 - 0.55 * windmill
  pose.leftArmSpread = -0.7
  pose.rightArmSpread = 0.7
}

/** Where the braced shoe and the free one meet the ground during a slide, from the ground point between the feet. */
export function getSlidingShoes(feet: { x: number; y: number; z: number }, movement: PlayerMovement) {
  const side = movement.bracedLeg * 0.17
  const sideX = side * Math.cos(movement.yaw)
  const sideZ = side * Math.sin(movement.yaw)
  return {
    braced: {
      x: feet.x + movement.slideDirection.x * SKID_FOOT_AHEAD + sideX,
      y: feet.y,
      z: feet.z + movement.slideDirection.z * SKID_FOOT_AHEAD - sideZ,
    },
    free: { x: feet.x - sideX, y: feet.y, z: feet.z + sideZ },
  }
}

/** The braced leg of the next slide is whichever leg is ahead when it starts. */
export function noteLeadingLeg(movement: PlayerMovement, pose: CharacterPose) {
  movement.leadingLeg = pose.leftLeg < pose.rightLeg ? -1 : 1
}

/** Layers the movement's leans and braced slide over the walk or run. */
export function addMovementPose(pose: CharacterPose, movement: PlayerMovement) {
  pose.pitch += movement.leanPitch + movement.settlePitch
  pose.roll += movement.leanRoll
  if (movement.skidWeight <= 0.002) return pose
  setBracePose(bracePose, movement)
  return blendPose(pose, bracePose, movement.skidWeight)
}
