import type { Gait } from './gait'
import { PLAYER_RUN_SPEED, PLAYER_WALK_SPEED } from './playerMotion'
import { clamp, clamp01, damp, fract, lerp } from '../../motionMath'

// ProceduralCharacter's legs in its body frame: ground at y 0, facing +z. Thighs swing forward with negative angles,
// knees bend with positive ones, and feet are the shoes' pitch against the ground (positive = toe down).
export const HIP_HEIGHT = 0.73
export const HIP_WIDTH = 0.17
export const THIGH_LENGTH = 0.36
export const SHIN_LENGTH = 0.29
/** From the ankle down to the sole. */
export const SOLE_DROP = 0.075
/** Heel, middle, and toe along the shoe from the ankle. */
export const SOLE_POINTS = [-0.135, 0.07, 0.275] as const
export const LEG_REACH = THIGH_LENGTH + SHIN_LENGTH
/** Steps are 1/0.8 longer than the legs cover, trading a little foot slip for a calmer cadence at walking speed. */
export const WALK_CADENCE = 0.8

export type CharacterPose = {
  bodyX: number
  bodyY: number
  bodyZ: number
  pitch: number
  roll: number
  twist: number
  headPitch: number
  leftArm: number
  rightArm: number
  leftArmSpread: number
  rightArmSpread: number
  leftLeg: number
  rightLeg: number
  leftLegSpread: number
  rightLegSpread: number
  leftKnee: number
  rightKnee: number
  leftFoot: number
  rightFoot: number
  /** How far the body rises above the feet, as in a run's flight. */
  lift: number
}

type PoseKey = keyof CharacterPose

export function createRestPose(): CharacterPose {
  return {
    bodyX: 0,
    bodyY: 0,
    bodyZ: 0,
    pitch: 0,
    roll: 0,
    twist: 0,
    headPitch: 0,
    leftArm: 0,
    rightArm: 0,
    leftArmSpread: 0.08,
    rightArmSpread: -0.08,
    leftLeg: 0,
    rightLeg: 0,
    leftLegSpread: 0,
    rightLegSpread: 0,
    leftKnee: 0.03,
    rightKnee: 0.03,
    leftFoot: 0,
    rightFoot: 0,
    lift: 0,
  }
}

const restPose = createRestPose()
const poseKeys = Object.keys(restPose) as PoseKey[]

export function blendPose(target: CharacterPose, other: CharacterPose, weight: number) {
  poseKeys.forEach((key) => {
    target[key] = lerp(target[key], other[key], weight)
  })
  return target
}

export function copyPose(target: CharacterPose, source: CharacterPose) {
  return Object.assign(target, source)
}

// Contact, down, passing, and up (Richard Williams' walk) for the leg that lands at phase 0 (`s`) and the other
// one (`w`); the second half of the cycle swaps the legs.
type KeyPose = Record<
  | 'stanceLeg'
  | 'stanceKnee'
  | 'stanceFoot'
  | 'swingLeg'
  | 'swingKnee'
  | 'swingFoot'
  | 'stanceArm'
  | 'swingArm'
  | 'lift'
  | 'pitch'
  | 'head'
  | 'shift',
  number
>

const walkKeys: { times: number[]; poses: KeyPose[] } = {
  times: [0, 0.125, 0.25, 0.375],
  poses: [
    {
      stanceLeg: -0.5,
      stanceKnee: 0.2,
      stanceFoot: -0.24,
      swingLeg: 0.48,
      swingKnee: 0.22,
      swingFoot: 0.4,
      stanceArm: 0.42,
      swingArm: -0.42,
      lift: 0,
      pitch: 0.03,
      head: 0,
      shift: 0.35,
    },
    {
      stanceLeg: -0.3,
      stanceKnee: 0.36,
      stanceFoot: 0,
      swingLeg: 0.4,
      swingKnee: 0.8,
      swingFoot: 0.78,
      stanceArm: 0.32,
      swingArm: -0.32,
      lift: 0,
      pitch: 0.05,
      head: 0.07,
      shift: 0.8,
    },
    {
      stanceLeg: 0.02,
      stanceKnee: 0.1,
      stanceFoot: 0,
      swingLeg: -0.1,
      swingKnee: 1.05,
      swingFoot: 0.32,
      stanceArm: 0.06,
      swingArm: -0.06,
      lift: 0,
      pitch: 0.035,
      head: 0.02,
      shift: 1,
    },
    {
      stanceLeg: 0.3,
      stanceKnee: 0.04,
      stanceFoot: 0.32,
      swingLeg: -0.44,
      swingKnee: 0.42,
      swingFoot: -0.1,
      stanceArm: -0.3,
      swingArm: 0.3,
      lift: 0,
      pitch: 0.03,
      head: -0.035,
      shift: 0.6,
    },
  ],
}

const runKeys: { times: number[]; poses: KeyPose[] } = {
  times: [0, 0.1, 0.21, 0.36],
  poses: [
    {
      stanceLeg: -0.62,
      stanceKnee: 0.3,
      stanceFoot: -0.18,
      swingLeg: 0.72,
      swingKnee: 1.2,
      swingFoot: 0.7,
      stanceArm: 0.8,
      swingArm: -0.9,
      lift: 0,
      pitch: 0.14,
      head: -0.04,
      shift: 0.2,
    },
    {
      stanceLeg: -0.18,
      stanceKnee: 0.7,
      stanceFoot: 0,
      swingLeg: 0.3,
      swingKnee: 1.85,
      swingFoot: 0.6,
      stanceArm: 0.35,
      swingArm: -0.45,
      lift: 0,
      pitch: 0.18,
      head: 0.06,
      shift: 0.5,
    },
    {
      stanceLeg: 0.4,
      stanceKnee: 0.2,
      stanceFoot: 0.55,
      swingLeg: -0.8,
      swingKnee: 1.45,
      swingFoot: 0.15,
      stanceArm: -0.45,
      swingArm: 0.35,
      lift: 0,
      pitch: 0.17,
      head: 0,
      shift: 0.3,
    },
    {
      stanceLeg: 0.72,
      stanceKnee: 0.6,
      stanceFoot: 0.6,
      swingLeg: -0.78,
      swingKnee: 0.55,
      swingFoot: -0.1,
      stanceArm: -0.85,
      swingArm: 0.8,
      lift: 0.1,
      pitch: 0.13,
      head: -0.04,
      shift: 0,
    },
  ],
}

type Track = { times: number[]; channels: Record<string, number[]> }

export function buildTrack({ times, poses }: { times: number[]; poses: KeyPose[] }): Track {
  const swap = (first: keyof KeyPose, second: keyof KeyPose) => [
    ...poses.map((pose) => pose[first]),
    ...poses.map((pose) => pose[second]),
  ]
  const both = (key: keyof KeyPose) => swap(key, key)
  return {
    times: [...times, ...times.map((time) => time + 0.5)],
    channels: {
      leftLeg: swap('stanceLeg', 'swingLeg'),
      rightLeg: swap('swingLeg', 'stanceLeg'),
      leftKnee: swap('stanceKnee', 'swingKnee'),
      rightKnee: swap('swingKnee', 'stanceKnee'),
      leftFoot: swap('stanceFoot', 'swingFoot'),
      rightFoot: swap('swingFoot', 'stanceFoot'),
      leftArm: swap('stanceArm', 'swingArm'),
      rightArm: swap('swingArm', 'stanceArm'),
      lift: both('lift'),
      pitch: both('pitch'),
      head: both('head'),
      // Toward the stance foot: left of the body while the left foot carries the weight.
      shift: [...poses.map((pose) => -pose.shift), ...poses.map((pose) => pose.shift)],
    },
  }
}

const walkTrack = buildTrack(walkKeys)
const runTrack = buildTrack(runKeys)

/** A looping cubic Hermite through unevenly spaced keys, with Catmull-Rom tangents. */
export function samplePeriodic(times: number[], values: number[], phase: number) {
  const count = times.length
  const index = times.filter((time) => time <= phase).length - 1
  const next = (index + 1) % count
  const start = times[index]
  const span = (next === 0 ? 1 : times[next]) - start
  const tangent = (key: number) => {
    const before = (key - 1 + count) % count
    const after = (key + 1) % count
    const beforeTime = before > key ? times[before] - 1 : times[before]
    const afterTime = after < key ? times[after] + 1 : times[after]
    return (values[after] - values[before]) / (afterTime - beforeTime)
  }
  const progress = (phase - start) / span
  const square = progress * progress
  const cube = square * progress
  return (
    (2 * cube - 3 * square + 1) * values[index] +
    (cube - 2 * square + progress) * span * tangent(index) +
    (-2 * cube + 3 * square) * values[next] +
    (cube - square) * span * tangent(next)
  )
}

export function trackValue(channel: string, phase: number, run: number) {
  const walking = samplePeriodic(walkTrack.times, walkTrack.channels[channel], phase)
  if (run <= 0.001) return walking
  return lerp(walking, samplePeriodic(runTrack.times, runTrack.channels[channel], phase), run)
}

/** The walk (run = 0) or run (run = 1) at `phase` of a two-step cycle, before it is set on the ground. */
export function getCyclePose(phase: number, run: number, pose = createRestPose()) {
  copyPose(pose, restPose)
  pose.leftLeg = trackValue('leftLeg', phase, run)
  pose.rightLeg = trackValue('rightLeg', phase, run)
  pose.leftKnee = trackValue('leftKnee', phase, run)
  pose.rightKnee = trackValue('rightKnee', phase, run)
  pose.leftFoot = trackValue('leftFoot', phase, run)
  pose.rightFoot = trackValue('rightFoot', phase, run)
  pose.leftArm = trackValue('leftArm', phase, run) - 0.3 * run
  pose.rightArm = trackValue('rightArm', phase, run) - 0.3 * run
  pose.leftArmSpread = 0.08 + 0.12 * run
  pose.rightArmSpread = -pose.leftArmSpread
  pose.lift = trackValue('lift', phase, run)
  pose.pitch = trackValue('pitch', phase, run)
  pose.headPitch = trackValue('head', phase, run)
  const shift = trackValue('shift', phase, run)
  pose.bodyX = 0.032 * shift * (1 - 0.6 * run)
  pose.roll = -0.05 * shift * (1 - 0.5 * run)
  pose.twist = -0.04 * (pose.leftLeg - pose.rightLeg)
  return pose
}

export function getLegChain(pose: CharacterPose, side: -1 | 1) {
  const thigh = side < 0 ? pose.leftLeg : pose.rightLeg
  const shin = thigh + (side < 0 ? pose.leftKnee : pose.rightKnee)
  const kneeY = HIP_HEIGHT - THIGH_LENGTH * Math.cos(thigh)
  const kneeZ = -THIGH_LENGTH * Math.sin(thigh)
  return {
    ankleY: kneeY - SHIN_LENGTH * Math.cos(shin),
    ankleZ: kneeZ - SHIN_LENGTH * Math.sin(shin),
    foot: (side < 0 ? pose.leftFoot : pose.rightFoot) - pose.pitch,
    pitch: pose.pitch,
  }
}

/** A point on the sole, `soleZ` along the shoe, in the body frame. */
export function getSolePoint(chain: ReturnType<typeof getLegChain>, soleZ: number) {
  const y = chain.ankleY - SOLE_DROP * Math.cos(chain.foot) - soleZ * Math.sin(chain.foot)
  const z = chain.ankleZ - SOLE_DROP * Math.sin(chain.foot) + soleZ * Math.cos(chain.foot)
  return {
    y: y * Math.cos(chain.pitch) - z * Math.sin(chain.pitch),
    z: y * Math.sin(chain.pitch) + z * Math.cos(chain.pitch),
  }
}

/** The lowest sole height, and where along the shoe the weight sits, so rolling heel to toe is not slip. */
export function getSoleContact(pose: CharacterPose, side: -1 | 1) {
  const chain = getLegChain(pose, side)
  const heights = SOLE_POINTS.map((soleZ) => getSolePoint(chain, soleZ).y)
  const lowest = Math.min(...heights)
  const weights = heights.map((height) => Math.exp(-(height - lowest) / 0.006))
  const total = weights.reduce((sum, weight) => sum + weight, 0)
  const pressureZ = weights.reduce((sum, weight, index) => sum + weight * SOLE_POINTS[index], 0) / total
  return { lowest, pressureZ }
}

/** Moving the hips over the stance foot must not drag the feet sideways, so both legs angle back by the shift. */
export function compensateHipShift(pose: CharacterPose) {
  const angle = Math.asin(clamp(pose.bodyX / (LEG_REACH + SOLE_DROP), -0.3, 0.3))
  pose.leftLegSpread -= angle
  pose.rightLegSpread -= angle
}

/** The lowest sole of either foot against the body, before `bodyY` lifts or lowers it. */
export function getLowestSoleInBody(pose: CharacterPose) {
  return Math.min(getSoleContact(pose, -1).lowest, getSoleContact(pose, 1).lowest)
}

/** Lowers or raises the body until the lower sole touches the ground, plus any flight lift. */
export function setPoseOnGround(pose: CharacterPose) {
  pose.bodyY = -getLowestSoleInBody(pose) + pose.lift
  return pose
}

/** The lowest sole of either foot after `setPoseOnGround`, in the character's frame (0 = on the ground). */
export function getLowestSole(pose: CharacterPose) {
  return getLowestSoleInBody(pose) + pose.bodyY
}

export function sampleStance(phase: number, run: number) {
  const pose = getCyclePose(phase, run)
  const left = getSoleContact(pose, -1)
  const right = getSoleContact(pose, 1)
  const side: -1 | 1 = left.lowest < right.lowest ? -1 : 1
  const low = side < 0 ? left : right
  const bodyY = -Math.min(left.lowest, right.lowest) + pose.lift
  return { pose, side, pressureZ: low.pressureZ, inContact: low.lowest + bodyY < 0.012 }
}

/**
 * How far the body travels per cycle when the weight-bearing sole stays still: the backward travel of that sole
 * point while in contact, over the share of the cycle spent in contact.
 */
export function calibrateStride(run: number) {
  const sampleCount = 360
  const samples = Array.from({ length: sampleCount + 1 }, (_, index) =>
    sampleStance((index % sampleCount) / sampleCount, run),
  )
  const planted = samples
    .slice(1)
    .map((sample, index) => ({ sample, previous: samples[index] }))
    .filter(({ sample, previous }) => sample.inContact && previous.inContact && previous.side === sample.side)
  const travel = planted.reduce((sum, { sample, previous }) => {
    const before = getSolePoint(getLegChain(previous.pose, sample.side), sample.pressureZ).z
    const now = getSolePoint(getLegChain(sample.pose, sample.side), sample.pressureZ).z
    return sum + before - now
  }, 0)
  return travel / Math.max(1e-6, planted.length / sampleCount)
}

export const STRIDES = { walk: calibrateStride(0), run: calibrateStride(1) }

const cyclePose = createRestPose()

export function createWalkCycle() {
  return { phase: 0, run: 0, amount: 0 }
}

export type WalkCycle = ReturnType<typeof createWalkCycle>

export function getStrideLength(cycle: WalkCycle) {
  return (lerp(STRIDES.walk, STRIDES.run, cycle.run) * Math.max(cycle.amount, 0.3)) / WALK_CADENCE
}

/**
 * Steps the cycle by the distance covered, so the feet keep pace with the ground at any speed or frame rate, and
 * blends from standing into the walk and from the walk into the run. `advancing` holds the legs while a skid or
 * brake poses them instead.
 */
export function stepWalkCycle(
  cycle: WalkCycle,
  speed: number,
  delta: number,
  walkSpeed = PLAYER_WALK_SPEED,
  advancing = true,
  pose = createRestPose(),
) {
  const step = clamp(delta, 0, 0.05)
  cycle.run = damp(cycle.run, clamp01((speed - walkSpeed) / (PLAYER_RUN_SPEED - walkSpeed)), 6, step)
  cycle.amount = damp(cycle.amount, clamp01(speed / (0.55 * walkSpeed)), 9, step)
  if (advancing) cycle.phase = fract(cycle.phase + (speed * step) / getStrideLength(cycle))
  const moving = getCyclePose(cycle.phase, cycle.run, cyclePose)
  return blendPose(copyPose(pose, restPose), moving, cycle.amount)
}

/** The key-pose walk and run as a `Gait`; a footfall is counted each time the cycle passes a contact pose. */
export function createKeyPosesGait(): Gait {
  const cycle = createWalkCycle()
  let footfalls = 0
  return {
    step({ speed, delta, walkSpeed, advancing }, pose) {
      const halfBefore = Math.floor(cycle.phase * 2)
      stepWalkCycle(cycle, speed, delta, walkSpeed, advancing, pose)
      footfalls += Number(Math.floor(cycle.phase * 2) !== halfBefore)
      compensateHipShift(pose)
      return pose
    },
    footfalls: () => footfalls,
  }
}
