import type { Gait, GaitInput } from './gait'
import { PLAYER_RUN_SPEED } from './playerMotion'
import {
  HIP_HEIGHT,
  HIP_WIDTH,
  LEG_REACH,
  SHIN_LENGTH,
  SOLE_DROP,
  SOLE_POINTS,
  THIGH_LENGTH,
  copyPose,
  createRestPose,
  type CharacterPose,
} from './walkCycle'
import { clamp, clamp01, damp, fract, lerp, smoothstep } from '../../motionMath'

// Feet stay where they land in town and two-bone IK bends the legs to reach them. Heights follow walkCycle's
// side-on leg model, the same one setPoseOnGround uses, so a planted sole ends exactly on the ground.

const [HEEL_Z, MIDDLE_Z, TOE_Z] = SOLE_POINTS
const TAU = Math.PI * 2

// Steps per second at the character's own walking speed and at a full run. Strides grow with speed to hold these,
// so fast walkers slide a trailing toe where the legs cannot reach instead of pattering.
const WALK_STEP_RATE = 2.8
const RUN_STEP_RATE = 3.6
// Share of a stride each foot spends down: over half while walking keeps one foot on the ground; a run flies.
const WALK_DUTY = 0.54
const RUN_DUTY = 0.3
/** A foot landing farther ahead of its hip than this would hang short of the ground until the body caught up. */
const LANDING_REACH = 0.5
const WALK_SWING_HEIGHT = 0.09
const RUN_SWING_HEIGHT = 0.2
/** Toe-up pitch at heel strike, coming down to the planted pitch over the strike's seconds. */
const HEEL_STRIKE_SHOE = -0.3
const HEEL_STRIKE_SECONDS = 0.1
const MAX_ROLL = 1
/** Planted ankles stay just inside full reach so the knee never locks and pops. */
const PLANT_REACH = LEG_REACH - 0.008
// Body height against the rest pose; the reach of the feet lowers it further, dipping in double support.
const WALK_HEIGHT = -0.03
const RUN_HEIGHT = -0.05
const LOWEST_HEIGHT = -0.12
const FLIGHT_RISE = 0.085
const STAND_STEP_SECONDS = 0.16
const STAND_STEP_TRIGGER = 0.07
const STAND_STEP_HEIGHT = 0.06
const STAND_FOOT_AHEAD = 0.02
/** Moving farther than this in one frame is a respawn or standing up, not a step. */
const REPLANT_DISTANCE = 1
const VELOCITY_RATE = 12

type Foot = {
  side: -1 | 1
  /** Town position of the sole's middle. */
  x: number
  z: number
  planted: boolean
  /** Height of the sole's lowest point above the ground while it is off it. */
  lift: number
  /** Pitch against the ground, positive = toe down. */
  shoe: number
  /** How far sliding into reach moved the planted foot this frame. */
  slideX: number
  slideZ: number
  fromX: number
  fromZ: number
  /** A swing leaves at the speed the foot was sliding: this is that speed times the swing's length. */
  launchX: number
  launchZ: number
  liftOffShoe: number
  liftOffHeight: number
  /** Swing progress already gone when this walking swing began, or -1 outside one. */
  swingStart: number
  /** Progress of a step taken while standing, or -1 outside one. */
  standStep: number
  /** 1 at heel strike, fading to 0 as the shoe comes down. */
  strike: number
}

type Body = { x: number; z: number; sin: number; cos: number }

type PlantedFeetState = {
  ready: boolean
  lastX: number
  lastZ: number
  velocityX: number
  velocityZ: number
  directionX: number
  directionZ: number
  phase: number
  run: number
  amount: number
  height: number
  footfalls: number
  /** This frame's step length, share of the stride spent on the ground, and stride length. */
  delta: number
  duty: number
  stride: number
  body: Body
  feet: [Foot, Foot]
}

const restPose = createRestPose()
/** Scratch for the ankle target in the character's frame (y up from the ground, z forward). */
const ankle = { y: 0, z: 0 }

export function createFoot(side: -1 | 1): Foot {
  return {
    side,
    x: 0,
    z: 0,
    planted: true,
    lift: 0,
    shoe: 0,
    slideX: 0,
    slideZ: 0,
    fromX: 0,
    fromZ: 0,
    launchX: 0,
    launchZ: 0,
    liftOffShoe: 0,
    liftOffHeight: 0,
    swingStart: -1,
    standStep: -1,
    strike: 0,
  }
}

export function createPlantedFeetGait(): Gait {
  const state: PlantedFeetState = {
    ready: false,
    lastX: 0,
    lastZ: 0,
    velocityX: 0,
    velocityZ: 0,
    directionX: 0,
    directionZ: 1,
    phase: 0,
    run: 0,
    amount: 0,
    height: 0,
    footfalls: 0,
    delta: 0,
    duty: WALK_DUTY,
    stride: 1,
    body: { x: 0, z: 0, sin: 0, cos: 1 },
    feet: [createFoot(-1), createFoot(1)],
  }
  return {
    step: (input, pose) => stepPlantedFeet(state, input, pose),
    footfalls: () => state.footfalls,
  }
}

export function stepPlantedFeet(state: PlantedFeetState, input: GaitInput, pose: CharacterPose) {
  const delta = clamp(input.delta, 0, 0.05)
  const jumped = !state.ready || Math.hypot(input.x - state.lastX, input.z - state.lastZ) > REPLANT_DISTANCE
  state.body.x = input.x
  state.body.z = input.z
  state.body.sin = Math.sin(input.yaw)
  state.body.cos = Math.cos(input.yaw)
  trackVelocity(state, input, delta)
  if (jumped) replantFeet(state)
  state.ready = true

  const walkSpeed = Math.max(input.walkSpeed, 0.1)
  const runShare = (input.speed - walkSpeed) / Math.max(PLAYER_RUN_SPEED - walkSpeed, 0.1)
  state.run = damp(state.run, clamp01(runShare), 6, delta)
  state.amount = damp(state.amount, clamp01(input.speed / (0.55 * walkSpeed)), 9, delta)
  state.delta = delta
  state.duty = lerp(WALK_DUTY, RUN_DUTY, state.run)
  state.stride = getStride(walkSpeed, state.run, state.amount)
  if (input.advancing) state.phase = fract(state.phase + (input.speed * delta) / state.stride)

  setBodyMotion(state, pose)
  state.feet.forEach((foot) => fadeHeelStrike(foot, delta))
  moveFeet(state, input)
  updateHeight(state, pose)
  poseLegs(state, pose)
  return pose
}

/** One stride is two steps; it grows with the walking speed so every walker keeps the same calm cadence. */
export function getStride(walkSpeed: number, run: number, amount: number) {
  const walkStride = (2 * walkSpeed) / WALK_STEP_RATE
  const runStride = (2 * PLAYER_RUN_SPEED) / RUN_STEP_RATE
  return lerp(walkStride, runStride, run) * Math.max(amount, 0.3)
}

export function trackVelocity(state: PlantedFeetState, input: GaitInput, delta: number) {
  const keep = Math.exp(-VELOCITY_RATE * delta)
  const time = Math.max(delta, 1e-6)
  state.velocityX = ((input.x - state.lastX) / time) * (1 - keep) + state.velocityX * keep
  state.velocityZ = ((input.z - state.lastZ) / time) * (1 - keep) + state.velocityZ * keep
  state.lastX = input.x
  state.lastZ = input.z
  const speed = Math.hypot(state.velocityX, state.velocityZ)
  const moving = speed > 0.3
  state.directionX = moving ? state.velocityX / speed : state.body.sin
  state.directionZ = moving ? state.velocityZ / speed : state.body.cos
}

export function replantFeet(state: PlantedFeetState) {
  state.feet.forEach((foot) => Object.assign(foot, createFoot(foot.side)))
  state.feet.forEach((foot) => placeUnderHip(state.body, foot))
  state.velocityX = 0
  state.velocityZ = 0
  state.height = 0
}

export function placeUnderHip(body: Body, foot: Foot) {
  foot.x = getHipGroundX(body, foot.side, 0)
  foot.z = getHipGroundZ(body, foot.side, 0)
}

export function getHipGroundX(body: Body, side: number, ahead: number) {
  return body.x + body.cos * side * HIP_WIDTH + body.sin * ahead
}

export function getHipGroundZ(body: Body, side: number, ahead: number) {
  return body.z - body.sin * side * HIP_WIDTH + body.cos * ahead
}

export function getFootForward(body: Body, foot: Foot) {
  return (foot.x - body.x) * body.sin + (foot.z - body.z) * body.cos
}

export function getFootLateral(body: Body, foot: Foot) {
  return (foot.x - body.x) * body.cos - (foot.z - body.z) * body.sin
}

export function setBodyMotion(state: PlantedFeetState, pose: CharacterPose) {
  copyPose(pose, restPose)
  const { run, amount, phase } = state
  // Each arm swings back as its own foot lands.
  const armSwing = lerp(0.42, 0.75, run) * amount * Math.cos(TAU * phase - 0.3)
  pose.leftArm = armSwing - 0.28 * run
  pose.rightArm = -armSwing - 0.28 * run
  pose.leftArmSpread = 0.08 + 0.1 * run
  pose.rightArmSpread = -pose.leftArmSpread
  pose.pitch = (0.03 + 0.12 * run) * amount
  pose.headPitch = -0.4 * pose.pitch
  // Peaks while the left foot is mid-stance, carrying the hips over it.
  const leftWeight = Math.cos(TAU * (phase - state.duty / 2)) * amount
  pose.bodyX = -0.03 * leftWeight
  pose.roll = 0.03 * leftWeight * (1 - 0.5 * run)
}

export function fadeHeelStrike(foot: Foot, delta: number) {
  foot.strike = Math.max(0, foot.strike - delta / HEEL_STRIKE_SECONDS)
}

export function moveFeet(state: PlantedFeetState, input: GaitInput) {
  if (!input.advancing) return slideFeet(state)
  if (input.speed > 0.25 && state.amount > 0.08) return walkFeet(state, input.speed)
  standFeet(state)
}

/** A skid or brake poses the legs itself, so the feet just slide along under the hips. */
export function slideFeet(state: PlantedFeetState) {
  const follow = 1 - Math.exp(-22 * state.delta)
  state.feet.forEach((foot) => slideFoot(state.body, foot, follow))
}

export function slideFoot(body: Body, foot: Foot, follow: number) {
  foot.x = lerp(foot.x, getHipGroundX(body, foot.side, 0), follow)
  foot.z = lerp(foot.z, getHipGroundZ(body, foot.side, 0), follow)
  foot.lift = lerp(foot.lift, 0, follow)
  foot.shoe = lerp(foot.shoe, 0, follow)
  foot.planted = true
  foot.swingStart = -1
  foot.standStep = -1
  foot.strike = 0
}

export function walkFeet(state: PlantedFeetState, speed: number) {
  state.feet.forEach((foot, index) => walkFoot(state, foot, fract(state.phase + index * 0.5), speed))
}

export function walkFoot(state: PlantedFeetState, foot: Foot, local: number, speed: number) {
  const { duty, stride } = state
  foot.standStep = -1
  if (local < duty) return landFoot(state, foot, 1)
  const progress = (local - duty) / (1 - duty)
  const timeToLanding = ((1 - progress) * (1 - duty) * stride) / Math.max(speed, 0.5)
  if (foot.swingStart < 0) startWalkingSwing(state, foot, progress, timeToLanding)
  const swing = clamp01((progress - foot.swingStart) / Math.max(1 - foot.swingStart, 1e-3))
  const ahead = Math.min((duty * stride) / 2, LANDING_REACH)
  const landingX = getHipGroundX(state.body, foot.side, 0) + state.velocityX * timeToLanding + state.directionX * ahead
  const landingZ = getHipGroundZ(state.body, foot.side, 0) + state.velocityZ * timeToLanding + state.directionZ * ahead
  // A cubic Hermite: leaves at the foot's sliding speed and lands at rest.
  const eased = smoothstep(swing)
  const launch = swing * (1 - swing) ** 2
  foot.x = lerp(foot.fromX, landingX, eased) + foot.launchX * launch
  foot.z = lerp(foot.fromZ, landingZ, eased) + foot.launchZ * launch
  // Rises early to clear the trailing toe, peaking a third of the way, and settles onto the ground without a drop.
  const height = lerp(WALK_SWING_HEIGHT, RUN_SWING_HEIGHT, state.run)
  foot.lift = lerp(foot.liftOffHeight, 0, swing) + height * 6.75 * launch
  foot.shoe = lerp(foot.liftOffShoe, HEEL_STRIKE_SHOE, eased)
}

export function leaveGround(foot: Foot) {
  foot.planted = false
  foot.fromX = foot.x
  foot.fromZ = foot.z
  foot.liftOffShoe = foot.shoe
  foot.liftOffHeight = foot.lift
  foot.strike = 0
}

/** A swing can begin late, as when walking starts mid-stride or a standing step turns into walking. */
export function startWalkingSwing(state: PlantedFeetState, foot: Foot, progress: number, duration: number) {
  const slideSpeed = duration / Math.max(state.delta, 1e-3)
  foot.launchX = foot.planted ? foot.slideX * slideSpeed : 0
  foot.launchZ = foot.planted ? foot.slideZ * slideSpeed : 0
  leaveGround(foot)
  foot.swingStart = progress
}

export function landFoot(state: PlantedFeetState, foot: Foot, strike: number) {
  foot.swingStart = -1
  foot.lift = 0
  if (foot.planted) return
  foot.planted = true
  foot.strike = strike
  foot.slideX = 0
  foot.slideZ = 0
  state.footfalls += 1
}

/** Standing or turning in place: one foot at a time steps back under its hip once it has drifted away. */
export function standFeet(state: PlantedFeetState) {
  state.feet.forEach((foot) => moveStandingFoot(state, foot))
  if (state.feet.some((foot) => foot.standStep >= 0)) return
  const [left, right] = state.feet
  const foot = getStandingNeed(state.body, left) >= getStandingNeed(state.body, right) ? left : right
  if (getStandingNeed(state.body, foot) <= STAND_STEP_TRIGGER) return
  leaveGround(foot)
  foot.standStep = 0
}

/** How far a foot has drifted from under its hip; a foot caught in the air comes down first. */
export function getStandingNeed(body: Body, foot: Foot) {
  const drift = Math.hypot(
    foot.x - getHipGroundX(body, foot.side, STAND_FOOT_AHEAD),
    foot.z - getHipGroundZ(body, foot.side, STAND_FOOT_AHEAD),
  )
  return foot.planted ? drift : drift + 1
}

export function moveStandingFoot(state: PlantedFeetState, foot: Foot) {
  foot.swingStart = -1
  if (foot.standStep < 0) return relaxFoot(foot, state.delta)
  foot.standStep = Math.min(1, foot.standStep + state.delta / STAND_STEP_SECONDS)
  const eased = smoothstep(foot.standStep)
  const arc = Math.sin(Math.PI * foot.standStep)
  foot.x = lerp(foot.fromX, getHipGroundX(state.body, foot.side, STAND_FOOT_AHEAD), eased)
  foot.z = lerp(foot.fromZ, getHipGroundZ(state.body, foot.side, STAND_FOOT_AHEAD), eased)
  foot.lift = lerp(foot.liftOffHeight, 0, foot.standStep) + STAND_STEP_HEIGHT * arc
  foot.shoe = lerp(foot.liftOffShoe, 0, foot.standStep) + 0.12 * arc
  if (foot.standStep < 1) return
  foot.standStep = -1
  landFoot(state, foot, 0)
}

export function relaxFoot(foot: Foot, delta: number) {
  foot.lift = damp(foot.lift, 0, 14, delta)
  foot.shoe = damp(foot.shoe, 0, 12, delta)
}

export function isOnGround(foot: Foot) {
  return foot.planted && foot.lift <= 0.001
}

export function updateHeight(state: PlantedFeetState, pose: CharacterPose) {
  const flightCenter = (state.duty + 0.5) / 2
  const flight = state.run * state.amount * FLIGHT_RISE * Math.max(0, Math.cos(2 * TAU * (state.phase - flightCenter)))
  const moving = lerp(WALK_HEIGHT, RUN_HEIGHT, state.run) * state.amount + flight
  const [left, right] = state.feet
  const reach = Math.min(getReachHeight(state.body, pose, left), getReachHeight(state.body, pose, right))
  const target = Math.max(LOWEST_HEIGHT, Math.min(moving, reach))
  state.height = damp(state.height, target, 30, state.delta)
}

/**
 * The highest the body may ride and still reach this foot, allowing for some heel or toe roll; farther feet slide.
 * A swinging foot counts once it is ahead of the hip, so the body lowers in time for its landing.
 */
export function getReachHeight(body: Body, pose: CharacterPose, foot: Foot) {
  const offset = getFootForward(body, foot) - HIP_HEIGHT * Math.sin(pose.pitch)
  const onGround = isOnGround(foot)
  if (!onGround && offset <= 0) return Infinity
  const horizontal = Math.max(0, Math.abs(offset) - (offset > 0 ? 0.06 : 0.14))
  if (horizontal >= PLANT_REACH) return Infinity
  const lift = onGround ? 0 : foot.lift
  return lift + SOLE_DROP + Math.sqrt(PLANT_REACH ** 2 - horizontal ** 2) - HIP_HEIGHT * Math.cos(pose.pitch)
}

export function poseLegs(state: PlantedFeetState, pose: CharacterPose) {
  pose.bodyY = state.height
  const [left, right] = state.feet
  const lowestSole = Math.min(poseLeg(state, pose, left), poseLeg(state, pose, right))
  pose.lift = Math.max(0, lowestSole)
}

/** Bends one leg to reach its foot and returns how high that sole's lowest point is. */
export function poseLeg(state: PlantedFeetState, pose: CharacterPose, foot: Foot) {
  const onGround = isOnGround(foot)
  if (onGround) plantShoe(state, pose, foot)
  const lift = onGround ? 0 : foot.lift
  setAnkle(getFootForward(state.body, foot), foot.shoe, lift)
  const shortfall = solveLeg(pose, foot, getFootLateral(state.body, foot), state.height)
  // A planted foot the leg falls short of is left for setPoseOnGround to bring down; a swinging one keeps its height.
  return onGround ? 0 : lift + shortfall
}

/** Rolls a planted shoe onto its heel (ahead of the hip) or toe (behind) as far as the leg's reach needs. */
export function plantShoe(state: PlantedFeetState, pose: CharacterPose, foot: Foot) {
  const hipY = state.height + HIP_HEIGHT * Math.cos(pose.pitch)
  const hipZ = HIP_HEIGHT * Math.sin(pose.pitch)
  const forward = getFootForward(state.body, foot)
  const ahead = forward > hipZ
  const soleZ = ahead ? HEEL_Z : TOE_Z
  const roll = getRollShoe(hipY, hipZ - (forward + soleZ - MIDDLE_Z), soleZ)
  foot.shoe = ahead ? Math.min(roll, HEEL_STRIKE_SHOE * foot.strike ** 2) : roll
  dragIntoReach(state.body, foot, hipY, hipZ)
}

/**
 * The pitch nearest flat that brings the ankle within reach of a hip at (`hipY`, `hipZ`) from the sole point
 * `soleZ` resting on the ground. As the shoe pitches about that point the ankle circles it, so the reachable pitches
 * form one arc around the pitch that points the ankle straight at the hip.
 */
export function getRollShoe(hipY: number, hipZ: number, soleZ: number) {
  const direction = Math.sign(soleZ)
  const radius = Math.hypot(SOLE_DROP, soleZ)
  const distance = Math.hypot(hipY, hipZ)
  const nearest = Math.atan2(soleZ, SOLE_DROP) + Math.atan2(hipZ, hipY)
  const spare = Math.acos(clamp((radius ** 2 + distance ** 2 - PLANT_REACH ** 2) / (2 * radius * distance), -1, 1))
  return direction * clamp(direction * nearest - spare, 0, MAX_ROLL)
}

/** A foot the hip cannot reach even fully rolled slides toward it, as a long stride's trailing toe does. */
export function dragIntoReach(body: Body, foot: Foot, hipY: number, hipZ: number) {
  setAnkle(getFootForward(body, foot), foot.shoe, 0)
  const along = ankle.z - hipZ
  const allowed = Math.sqrt(Math.max(0, PLANT_REACH ** 2 - (hipY - ankle.y) ** 2))
  const shift = -Math.sign(along) * Math.max(0, Math.abs(along) - allowed)
  foot.slideX = body.sin * shift
  foot.slideZ = body.cos * shift
  foot.x += foot.slideX
  foot.z += foot.slideZ
}

/** The ankle above a shoe pitched by `shoe` whose heel (toe up) or toe (toe down) is `lift` above the ground. */
export function setAnkle(forward: number, shoe: number, lift: number) {
  const soleZ = shoe < 0 ? HEEL_Z : TOE_Z
  ankle.y = lift + SOLE_DROP * Math.cos(shoe) + soleZ * Math.sin(shoe)
  ankle.z = forward + soleZ - MIDDLE_Z + SOLE_DROP * Math.sin(shoe) - soleZ * Math.cos(shoe)
}

/**
 * Two-bone IK from the hip to `ankle`, in walkCycle's side-on model (hips on a body pitched about its ground origin);
 * the sideways reach becomes leg spread, measured against the hips' sway and roll. Returns how far above the target
 * the ankle ends when the target is out of reach.
 */
export function solveLeg(pose: CharacterPose, foot: Foot, lateral: number, height: number) {
  const cos = Math.cos(pose.pitch)
  const sin = Math.sin(pose.pitch)
  const y = ankle.y - height
  const towardY = y * cos + ankle.z * sin - HIP_HEIGHT
  const towardZ = ankle.z * cos - y * sin
  const targetDistance = Math.hypot(towardY, towardZ)
  const distance = clamp(targetDistance, 0.1, LEG_REACH - 0.0005)
  const hipAngle = Math.acos(
    clamp((THIGH_LENGTH ** 2 + distance ** 2 - SHIN_LENGTH ** 2) / (2 * THIGH_LENGTH * distance), -1, 1),
  )
  const kneeInner = Math.acos(
    clamp((THIGH_LENGTH ** 2 + SHIN_LENGTH ** 2 - distance ** 2) / (2 * THIGH_LENGTH * SHIN_LENGTH), -1, 1),
  )
  const thigh = Math.atan2(-towardZ, -towardY) - hipAngle
  const hipLateral = pose.bodyX + foot.side * HIP_WIDTH * Math.cos(pose.roll) - HIP_HEIGHT * Math.sin(pose.roll)
  const spread = Math.asin(clamp((lateral - hipLateral) / distance, -0.6, 0.6)) - pose.roll
  setLegChannels(pose, foot.side, thigh, Math.PI - kneeInner, spread, foot.shoe)
  const hipY = height + HIP_HEIGHT * cos
  return (ankle.y - hipY) * (distance / Math.max(targetDistance, 1e-6) - 1)
}

export function setLegChannels(
  pose: CharacterPose,
  side: -1 | 1,
  thigh: number,
  knee: number,
  spread: number,
  shoe: number,
) {
  if (side < 0) {
    pose.leftLeg = thigh
    pose.leftKnee = knee
    pose.leftLegSpread = spread
    pose.leftFoot = shoe
    return
  }
  pose.rightLeg = thigh
  pose.rightKnee = knee
  pose.rightLegSpread = spread
  pose.rightFoot = shoe
}
