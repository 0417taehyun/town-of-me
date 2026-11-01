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
// center (0.6 m), so the keys themselves square the bat there and the aim only trims what is left. At the slot the bat
// points straight back and a little higher than the research's (-117°, 13°), which laid it through the back shoulder.
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
  batAzimuth: [-156, -166, -169, -171, -150, -92, 11, 100, 187, 278],
  batElevation: [45, 40, 41, 42, 50, 24, -30, 24, 38, -7],
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
 * A judged swing's last stretch to the ball takes this long (ms) from the windup's end, for a swing the camera saw no
 * start of: the research's launch-to-contact compressed to the game's trigger-to-contact time. One the camera saw
 * begin, nearer the ball, takes less (lastStretchMs). The rest of SWING_MS plays on to the finish, slowing from the
 * contact's speed.
 */
export const CONTACT_DELAY_MS = 46
export const SWING_MS = 380

/**
 * A swing the camera saw begin reaches swing second `readyAt` by the moment the camera expects its grip to cross the
 * midline, still moving at about the data's own pace (a swing second a second), and eases on into the slot over
 * `easeMs` (ms), where the bat still points back behind the batter and no aim has turned it yet, so a ball judged in
 * play can aim it without a jump. Unless it is judged by then, it goes back to the windup from there as a checked
 * swing does.
 */
export const BEGUN_SWING = { readyAt: -0.086, easeMs: 100 }

/**
 * A checked swing: the bat stops over `stopMs` (ms), stays a moment (`holdMs`), then goes back to the windup over
 * `backMs`. A bat moving slower than `fullStopRate` (swing seconds per ms: the data's own pace) stops and stays for
 * that much less, so one already at rest goes straight back.
 */
export const CHECK_SWING_MS = { stopMs: 70, holdMs: 120, backMs: 380, fullStopRate: 0.001 }

// After the finish the batter comes back to its stance along keys of its own, a path the research does not measure.
// Every turn unwinds one way, the way it came, but low and in front: the chest turns back first and the hands drop to
// the belly with the bat level, carry it down in front of the knees, then lift it past the plate side and back over
// the rear shoulder. Taking the short way round, or winding the swing back at its own height, drives the bat through
// the head and the arms through each other; folding the hands up under the chin instead makes the bat, seen from the
// batting camera behind the batter, seem to stick out of the head.

export const RETURN_KEY_IDS = ['finish', 'settle', 'relax', 'carry', 'lift', 'stance'] as const
export type ReturnKeyId = (typeof RETURN_KEY_IDS)[number]

/** Ms from the finish, where a swing's SWING_MS ends: a held finish that settles a little, then the way back. */
export const RETURN_KEY_MS: Record<ReturnKeyId, number> = {
  finish: 0,
  settle: 520,
  relax: 736,
  carry: 1048,
  lift: 1372,
  stance: 1720,
}

/**
 * The return's own keys between the finish and the stance (settle, relax, carry, lift), in RETURN_KEY_IDS order; the
 * first and last keys are SWING_KEYS' finish and stance. Every channel not keyed here goes `share` of the way from its
 * finish to its stance. The front foot steps back off the ground instead of sliding.
 */
export const RETURN_KEYS = {
  share: [0.02, 0.15, 0.45, 0.8],
  chestYaw: [161, 128, 75, 65],
  gripAngle: [207, 163, 121, 88],
  gripRadius: [0.71, 0.57, 0.5, 0.34],
  gripY: [-0.01, -0.18, -0.13, -0.04],
  batAzimuth: [274, 205, 92, -41],
  batElevation: [-10, 0, -41, -12],
  frontFootX: [0.36, 0.36, 0.36, 0.32],
  frontFootLift: [0, 0, 0, 0.015],
  frontHeel: [0, 0, 0, 10],
} satisfies Partial<Record<TrackChannel | 'share', number[]>>

/** The finish holds this long, settling a few degrees, then the batter comes back to its stance over RETURN_MS. */
export const FINISH_HOLD_MS = RETURN_KEY_MS.settle
export const RETURN_MS = RETURN_KEY_MS.stance - RETURN_KEY_MS.settle
/** Once back in its stance, the batter's waggle fades back in over this long. */
export const WAGGLE_FADE_MS = 300

type KeyedChannel = keyof typeof SWING_KEYS
/** The grip is interpolated round the pelvis's axis (angle and radius) instead of in x and z. */
export type TrackChannel = Exclude<KeyedChannel, 'gripX' | 'gripZ'> | 'gripAngle' | 'gripRadius'

/**
 * A pose of the swing: every channel, the grip both round the body and in x and z, and each elbow's swivel (degrees)
 * off its pole, which the batter solves once to keep the forearms off the bat.
 */
export type SwingPose = Record<KeyedChannel | TrackChannel, number> & { backSwivel: number; frontSwivel: number }

export type SwingMotion = {
  tracks: Record<TrackChannel, MonotoneTrack>
  /** The return's tracks by ms from the finish. */
  returnTracks: Record<TrackChannel, MonotoneTrack>
  /** The grip shift that puts the contact key's sweet spot on the contact point, faded in by `aim` (batter frame). */
  aimOffset: Vec3
  /** Each elbow's swivel [back, front] by swing second, or null before the batter has solved them. */
  swivels: [MonotoneTrack, MonotoneTrack] | null
  /** Each elbow's swivel [back, front] by return ms, or null before the batter has solved them. */
  returnSwivels: [MonotoneTrack, MonotoneTrack] | null
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

/** Every track channel's values at the swing's keys, the grip as its angle and radius round the pelvis's axis. */
export function swingTrackKeys(): Record<TrackChannel, number[]> {
  const { gripX, gripZ, ...keyed } = SWING_KEYS
  const gripRadius = gripX.map((x, index) => Math.hypot(x, gripZ[index]))
  return { ...keyed, gripAngle: gripAngles(), gripRadius }
}

/** A channel's values at the return's keys, from its `finish` to its `stance`: keyed in RETURN_KEYS, else its share. */
export function returnKeyValues(channel: TrackChannel, finish: number, stance: number) {
  const keyed: Partial<Record<TrackChannel, number[]>> = RETURN_KEYS
  const between = keyed[channel] ?? RETURN_KEYS.share.map((share) => lerp(finish, stance, share))
  return [finish, ...between, stance]
}

/** The return's tracks, from the swing's finish key back to its stance key. */
export function createReturnTracks(swingKeys: Record<TrackChannel, number[]>) {
  const times = RETURN_KEY_IDS.map((id) => RETURN_KEY_MS[id])
  const keys = Object.fromEntries(
    Object.entries<number[]>(swingKeys).map(([channel, values]) => [
      channel,
      returnKeyValues(channel as TrackChannel, values[values.length - 1], values[0]),
    ]),
  ) as Record<TrackChannel, number[]>
  return keyedTracks<TrackChannel>(times, keys)
}

/** The swing's and its return's tracks, without its aim or elbow swivels, which the batter solves (batter.ts). */
export function createSwingMotion(): SwingMotion {
  const times = SWING_KEY_IDS.map((id) => SWING_KEY_TIMES[id])
  const swingKeys = swingTrackKeys()
  return {
    tracks: keyedTracks<TrackChannel>(times, swingKeys),
    returnTracks: createReturnTracks(swingKeys),
    aimOffset: { x: 0, y: 0, z: 0 },
    swivels: null,
    returnSwivels: null,
  }
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

/** The return's pose `ms` after the finish, from the held finish back to the stance (its aim is 0 all the way). */
export function sampleReturnPose(motion: SwingMotion, ms: number): SwingPose {
  const pose = sampleTracks(motion.returnTracks, ms) as SwingPose
  pose.backSwivel = motion.returnSwivels ? sampleTrack(motion.returnSwivels[0], ms) : 0
  pose.frontSwivel = motion.returnSwivels ? sampleTrack(motion.returnSwivels[1], ms) : 0
  setGripFromAngle(pose)
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

/** How long (ms) a swing plays on from the ball to its finish. */
export const FOLLOW_MS = SWING_MS - CONTACT_DELAY_MS

/**
 * The pace (swing seconds per ms) a judged swing meets the ball at second `contactAt` with when it comes from the
 * windup's end, the whole way in CONTACT_DELAY_MS.
 */
export function windupPace(contactAt: number) {
  return (contactAt - windupSeconds(1)) / CONTACT_DELAY_MS
}

/**
 * How long (ms) the last stretch of a swing on its way takes from swing second `seconds`, moving at `rate` (swing
 * seconds per ms): as long as it takes to the contact key speeding up smoothly from that rate to three quarters of
 * windupPace there, so a ball met further on, out in front of the plate, still meets a bat no faster than one from the
 * windup. From near the slot that is about half as long as from the windup, and it is never longer.
 */
export function lastStretchMs(seconds: number, rate: number) {
  const { contact } = SWING_KEY_TIMES
  return Math.min(CONTACT_DELAY_MS, (3 * (contact - seconds)) / (rate + 1.5 * windupPace(contact)))
}

/**
 * About where (swing seconds) a swing the camera saw begin at `startedMs` (game ms), to reach BEGUN_SWING's `readyAt`
 * by `readyMs`, is drawn at `nowMs`, the windup's end where it left from, and how fast it moves on (swing seconds per
 * ms; none counted before `readyMs`): on its way there, easing on into the slot, then back to the windup as a checked
 * swing goes (CHECK_SWING_MS). The stage times a last stretch from it (lastStretchMs).
 */
export function begunSwingState(startedMs: number, readyMs: number, nowMs: number) {
  const { footStrike, slot } = SWING_KEY_TIMES
  const { readyAt, easeMs } = BEGUN_SWING
  const toReady = clamp01((nowMs - startedMs) / (readyMs - startedMs))
  if (nowMs < readyMs) return { seconds: lerp(footStrike, readyAt, toReady), rate: 0 }
  const easing = 1 - clamp01((nowMs - readyMs) / easeMs)
  const back = smoothstep(clamp01((nowMs - readyMs - easeMs) / CHECK_SWING_MS.backMs))
  const seconds = lerp(slot - (slot - readyAt) * easing ** 3, footStrike, back)
  return { seconds, rate: (3 * easing ** 2 * (slot - readyAt)) / easeMs }
}

/**
 * How fast (swing seconds per ms) a bat that came at `pace` (swing seconds per ms) over its last stretch meets the ball
 * at second `contactAt`: that pace, but never slower than the follow-through's, so the bat only slows after the ball.
 */
export function contactRate(contactAt: number, pace: number) {
  return Math.max(pace, (SWING_KEY_TIMES.finish - contactAt) / FOLLOW_MS)
}

/**
 * Swing seconds `sinceContactMs` after a swing met the ball at second `contactAt` moving at `rate` (swing seconds per
 * ms): on to the finish over FOLLOW_MS, slowing from that speed to a stop the way a bat decelerates after the ball,
 * from the windup about three times as long as it took to get there.
 */
export function followSeconds(contactAt: number, rate: number, sinceContactMs: number) {
  const span = SWING_KEY_TIMES.finish - contactAt
  const onward = Math.min(1, Math.max(0, sinceContactMs) / FOLLOW_MS)
  return contactAt + span * (1 - (1 - onward) ** ((rate * FOLLOW_MS) / span))
}
