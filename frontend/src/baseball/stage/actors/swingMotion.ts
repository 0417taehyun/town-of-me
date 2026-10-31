import { MathUtils } from 'three'
import type { Vec3 } from '../../../data/models'
import { clamp01, lerp, smoothstep, wrapAngle } from '../../../motionMath'
import { keyedTracks, type MonotoneTrack, sampleTrack, sampleTracks } from './keyframes'

// The batter's swing as data: the pose lab's pick, "레퍼런스형 · 웅크린 컴팩트". It is the median of 649 measured swings
// (Driveline OpenBiomechanics, matching Welch 1995): angles 1:1, scaled by leg length (feet) and arm reach (grip) for the
// town character, on a compact crouch. The knees bend 55°/60° at stance (research 38°/47°); the load is a 1.2 cm toe
// lift, the stride 7 cm from a wide stance, the waggle quiet. The chest leans 12° over the bent knees, with the hands
// 3 cm lower and further out so the lean keeps the chin clear. At contact the pelvis sits back and off the plate and the
// front elbow points down, so the chibi's short front arm meets the bat at an angle instead of running along it. The
// contact key's grip is the pose lab's raised by the 28 cm its aim lifted it to meet a ball at the strike zone's
// center (0.6 m), so the keys themselves square the bat there and the aim only trims what is left.
//
// Units are the batter frame of ballplayerRig.ts (town units, about 2.1 tall), with +x toward the pitcher, +y up, and
// +z toward the plate. Angles are degrees: a yaw of 0 faces the plate and +90 the pitcher; an azimuth of 0 points at the
// plate, +90 at the pitcher, and -90 at the catcher, kept unwrapped so the bat's counts up through the swing; elevation
// up is positive; tilt leans the spine toward the plate, side toward the catcher, roll lifts the front shoulder; pitch
// tips the head down.

export const SWING_KEY_IDS = [
  'stance',
  'load',
  'stride',
  'footStrike',
  'launch',
  'slot',
  'contact',
  'extension',
  'follow',
  'finish',
] as const
export type SwingKeyId = (typeof SWING_KEY_IDS)[number]

/** Seconds from contact (the research medians: foot strike -175 ms, launch -106, mid-swing -53, extension +60). */
export const SWING_KEY_TIMES: Record<SwingKeyId, number> = {
  stance: -0.986,
  load: -0.519,
  stride: -0.33,
  footStrike: -0.175,
  launch: -0.106,
  slot: -0.053,
  contact: 0,
  extension: 0.06,
  follow: 0.15,
  finish: 0.3,
}

/**
 * Each channel's value at each key, in SWING_KEY_IDS order:
 * - the pelvis's shift (x toward the pitcher, z toward the plate) and turn; its height follows from the knees' flexion;
 * - the chest's turn about its tilted spine;
 * - the grip, the midpoint of the hands, offset from the back shoulder's grip origin, and `aim`, the weight of the
 *   correction that puts the sweet spot on the contact point (1 at contact);
 * - the bat's direction from knob to barrel and each elbow's pole;
 * - the front ankle over the ground and the back foot's ball, which it pivots on, with their toe turns and heel lifts,
 *   and each knee's direction (the back knee drives toward the pitcher);
 * - the head, its eyes on the ball and held still through contact.
 */
export const SWING_KEYS = {
  pelvisX: [-0.06, -0.08, -0.05, 0, 0.058, 0.03, -0.02, 0.02, 0.07, 0.07],
  pelvisZ: [0, 0, 0, 0, 0, -0.025, -0.05, -0.025, -0.025, -0.025],
  pelvisYaw: [-4, -17, -15, -11, 25, 62, 93, 101, 105, 118],
  frontKnee: [55, 61, 59, 55, 49, 40, 25, 13, 20, 22],
  backKnee: [60, 62, 62, 63, 68, 74, 74, 65, 57, 50],
  chestYaw: [-10, -16, -18, -20, 3, 40, 93, 113, 135, 165],
  chestTilt: [12, 15, 15, 16, 14, 13, 14, 17, 19, 14],
  chestSide: [-1, 2, 4, 6, 4, 6, 10, 15, 14, 9],
  chestRoll: [-10, -14, -13, -13, 0, 4, 6, 6, 0, -6],
  gripX: [0, -0.04, -0.06, -0.07, 0.06, 0.28, 0.45, 0.42, 0.16, -0.37],
  gripY: [-0.03, -0.06, -0.035, -0.03, -0.06, -0.14, 0.126, -0.08, 0.18, 0],
  gripZ: [0.38, 0.37, 0.34, 0.34, 0.26, 0.17, -0.09, -0.33, -0.62, -0.62],
  aim: [0, 0, 0, 0, 0, 0, 1, 0, 0, 0],
  batAzimuth: [-156, -166, -169, -171, -150, -117, 11, 100, 187, 278],
  batElevation: [45, 40, 41, 42, 50, 13, -30, 24, 38, -7],
  frontPoleAzimuth: [30, 20, 20, 20, 40, 60, 110, 110, 150, 165],
  frontPoleElevation: [-70, -70, -70, -70, -60, -50, -70, -60, -50, -70],
  backPoleAzimuth: [-100, -100, -100, -100, -120, -50, -30, 60, 60, 130],
  backPoleElevation: [-50, -40, -40, -55, -70, -75, -70, -80, -80, 20],
  frontFootX: [0.29, 0.27, 0.31, 0.36, 0.36, 0.36, 0.36, 0.36, 0.36, 0.36],
  frontFootLift: [0, 0.012, 0.015, 0, 0, 0, 0, 0, 0, 0],
  frontFootYaw: [5, 0, 15, 30, 35, 40, 45, 50, 60, 75],
  frontHeel: [0, 12, 6, 0, 0, 0, 0, 0, 0, 0],
  backFootX: [-0.27, -0.27, -0.27, -0.27, -0.27, -0.27, -0.215, -0.215, -0.205, -0.2],
  backFootYaw: [0, 0, 0, 5, 45, 65, 78, 80, 85, 90],
  backHeel: [0, 0, 0, 1, 9, 26, 35, 30, 26, 19],
  frontKneeAzimuth: [-25, -40, -40, -30, -20, -10, 0, 10, 25, 40],
  backKneeAzimuth: [35, 22, 35, 47, 59, 71, 78, 80, 86, 94],
  headYaw: [85, 85, 85, 85, 80, 65, 40, 40, 45, 60],
  headPitch: [5, 5, 5, 5, 10, 25, 40, 35, 25, 10],
} satisfies Record<string, number[]>

/** What no key changes: the pelvis's forward tilt and each foot's distance from the plate line. */
export const SWING_CONSTANTS = { pelvisTilt: 6, frontFootZ: -0.05, backFootZ: 0.155 }

/** The stance's idle bat waggle: degrees of azimuth and elevation, grip bob (units), and beats per second. */
export const SWING_WAGGLE = { azimuth: 2.5, elevation: 4, gripY: 0.007, rate: 1.5 }

/**
 * The bat meets the ball this long after a swing starts (ms): the research's launch-to-contact compressed to the
 * game's trigger-to-contact time. The rest of SWING_MS plays on to the finish at about real speed.
 */
export const CONTACT_DELAY_MS = 46
export const SWING_MS = 380
/** The finish holds this long, then the batter eases back into the windup over RETURN_MS. */
export const FINISH_HOLD_MS = 520
export const RETURN_MS = 480

type KeyedChannel = keyof typeof SWING_KEYS
/** The grip is interpolated round the pelvis's axis (angle and radius) instead of in x and z. */
type TrackChannel = Exclude<KeyedChannel, 'gripX' | 'gripZ'> | 'gripAngle' | 'gripRadius'

/**
 * A pose of the swing: every channel, the grip both round the body and in x and z, and each elbow's swivel (degrees)
 * off its pole, which the batter solves once to keep the forearms off the bat.
 */
export type SwingPose = Record<KeyedChannel | TrackChannel, number> & { backSwivel: number; frontSwivel: number }

export type SwingMotion = {
  tracks: Record<TrackChannel, MonotoneTrack>
  /** The grip shift that puts the contact key's sweet spot on the contact point, faded in by `aim` (batter frame). */
  aimOffset: Vec3
  /** Each elbow's swivel [back, front] by swing second, or null before the batter has solved them. */
  swivels: [MonotoneTrack, MonotoneTrack] | null
}

/** Where the stance waggle's beat is (`at`, seconds on any clock) and how much of it plays (0..1). */
export type Waggle = { at: number; amount: number }

const STILL: Waggle = { at: 0, amount: 0 }

/** `angle` (degrees) moved by whole turns to within half a turn of `previous`. */
export function nearestTurn(angle: number, previous: number) {
  return previous + MathUtils.radToDeg(wrapAngle(MathUtils.degToRad(angle - previous)))
}

/**
 * The grip's angle round the pelvis's axis at each key (degrees, from the plate toward the pitcher), each within half a
 * turn of the one before, so the hands orbit the body between keys the way a swing does instead of cutting through it.
 */
export function gripAngles() {
  const angles: number[] = []
  SWING_KEYS.gripX.forEach((gripX, index) => {
    const angle = MathUtils.radToDeg(Math.atan2(gripX, SWING_KEYS.gripZ[index]))
    angles.push(nearestTurn(angle, angles[index - 1] ?? angle))
  })
  return angles
}

/** The swing's tracks, without its aim or elbow swivels, which the batter solves (batter.ts). */
export function createSwingMotion(): SwingMotion {
  const times = SWING_KEY_IDS.map((id) => SWING_KEY_TIMES[id])
  const { gripX, gripZ, ...keyed } = SWING_KEYS
  const gripRadius = gripX.map((x, index) => Math.hypot(x, gripZ[index]))
  const tracks = keyedTracks<TrackChannel>(times, { ...keyed, gripAngle: gripAngles(), gripRadius })
  return { tracks, aimOffset: { x: 0, y: 0, z: 0 }, swivels: null }
}

/** The pose `seconds` from contact, with the aim faded in by its weight and `waggle` added to the bat and grip. */
export function sampleSwingPose(motion: SwingMotion, seconds: number, waggle: Waggle = STILL): SwingPose {
  const pose = sampleTracks(motion.tracks, seconds) as SwingPose
  pose.backSwivel = motion.swivels ? sampleTrack(motion.swivels[0], seconds) : 0
  pose.frontSwivel = motion.swivels ? sampleTrack(motion.swivels[1], seconds) : 0
  setGripFromAngle(pose)
  pose.gripX += pose.aim * motion.aimOffset.x
  pose.gripY += pose.aim * motion.aimOffset.y
  pose.gripZ += pose.aim * motion.aimOffset.z
  const beat = Math.PI * 2 * SWING_WAGGLE.rate * waggle.at
  pose.batAzimuth += SWING_WAGGLE.azimuth * Math.sin(beat) * waggle.amount
  pose.batElevation += SWING_WAGGLE.elevation * Math.sin(beat * 0.5 + 1.1) * waggle.amount
  pose.gripY += SWING_WAGGLE.gripY * Math.sin(beat + 0.6) * waggle.amount
  return pose
}

export function setGripFromAngle(pose: SwingPose) {
  const angle = MathUtils.degToRad(pose.gripAngle)
  pose.gripX = pose.gripRadius * Math.sin(angle)
  pose.gripZ = pose.gripRadius * Math.cos(angle)
}

/** Swing seconds for a windup `load`: 0 the stance, 0.5 the toe lift (the load key), 1 the front foot down. */
export function windupSeconds(load: number) {
  const { stance, load: lifted, stride, footStrike } = SWING_KEY_TIMES
  const amount = clamp01(load)
  if (amount <= 0.5) return lerp(stance, lifted, amount / 0.5)
  if (amount <= 0.75) return lerp(lifted, stride, (amount - 0.5) / 0.25)
  return lerp(stride, footStrike, (amount - 0.75) / 0.25)
}

/**
 * Swing seconds `elapsedMs` into a swing that left the windup at second `from` and meets the ball at second
 * `contactAt`: that stretch compressed into CONTACT_DELAY_MS, then on to the finish over the rest of SWING_MS.
 */
export function swingSeconds(from: number, contactAt: number, elapsedMs: number) {
  if (elapsedMs <= CONTACT_DELAY_MS) return lerp(from, contactAt, Math.max(0, elapsedMs) / CONTACT_DELAY_MS)
  const onward = Math.min(1, (elapsedMs - CONTACT_DELAY_MS) / (SWING_MS - CONTACT_DELAY_MS))
  return lerp(contactAt, SWING_KEY_TIMES.finish, onward)
}

/**
 * Eases from the held finish back to the windup pose `amount` (0..1) of the way. The bat and the hands unwind the way
 * they came: taking the short way round instead drives the knob through the chest and the head.
 */
export function blendSwingPoses(from: SwingPose, to: SwingPose, amount: number): SwingPose {
  const eased = smoothstep(clamp01(amount))
  const pose = Object.fromEntries(
    Object.entries(to).map(([channel, target]) => [channel, lerp(from[channel as keyof SwingPose], target, eased)]),
  ) as SwingPose
  setGripFromAngle(pose)
  return pose
}
