// For tests only: the swings the batter's overlap tests play, the looks of the town character creator they wear, and
// the deepest each sinks the batter into itself (batterOverlap.ts). Every look meets the same grid of pitches: the
// zone's corners and edges at the front of the reach, where the arms stretch furthest, PERFECT, and late. Nothing in
// the app imports this, so it never reaches the production bundle.
import type { Vec3 } from '../data/models'
import { type AppearanceField, type PlayerProfile, PROFILE_CHOICES } from '../data/playerProfile'
import { type BattingSide, CONTACT_DEPTH } from '../baseball/game/field'
import { type PitchTypeId, pitchPosition, planPitch, secondsAtDepth } from '../baseball/game/pitch'
import { PITCH_TARGET_BAND } from '../baseball/game/pitchSchedule'
import {
  type Batter,
  batterPoseAt,
  beginSwing,
  checkSwing,
  judgeSwing,
  NO_SWING,
  poseBatter,
} from '../baseball/stage/actors/batter'
import {
  BEGUN_SWING,
  begunSwingState,
  CONTACT_DELAY_MS,
  FINISH_HOLD_MS,
  FOLLOW_MS,
  lastStretchMs,
  RETURN_MS,
  SWING_MS,
  WAGGLE_FADE_MS,
} from '../baseball/stage/actors/swingMotion'
import { armStretch, batterOverlaps, OVERLAP_PAIRS } from './batterOverlap'

/** A swing is back in its stance this long after it starts (ms). */
export const RETURNED_MS = SWING_MS + FINISH_HOLD_MS + RETURN_MS

/** Option `index` of `field`, counting round its choices. */
export function optionAt<Field extends AppearanceField>(field: Field, index: number) {
  const { options } = PROFILE_CHOICES[field]
  return options[index % options.length] as PlayerProfile[Field]
}

/**
 * Every hat with every hair (they fill the same place round the head), and every other option the town character
 * creator offers spread over them, so each one is worn at least once.
 */
export const LOOKS: Partial<PlayerProfile>[] = PROFILE_CHOICES.hat.options.flatMap((hat, hatIndex) =>
  PROFILE_CHOICES.hair.options.map((hair, hairIndex) => {
    const index = hatIndex * PROFILE_CHOICES.hair.options.length + hairIndex
    const spread = ['ears', 'nose', 'mustache', 'top', 'bottom', 'shoes'] as const
    return { hat, hair, ...Object.fromEntries(spread.map((field) => [field, optionAt(field, index + hatIndex)])) }
  }),
)

/** The zone's corners, edges, and center (catcher's x, height), by name, the inside -x for a right-handed batter. */
export const ZONE = {
  'in-low': { x: -PITCH_TARGET_BAND.side, y: PITCH_TARGET_BAND.low },
  'mid-low': { x: 0, y: PITCH_TARGET_BAND.low },
  'out-low': { x: PITCH_TARGET_BAND.side, y: PITCH_TARGET_BAND.low },
  'in-mid': { x: -PITCH_TARGET_BAND.side, y: (PITCH_TARGET_BAND.low + PITCH_TARGET_BAND.high) / 2 },
  middle: { x: 0, y: (PITCH_TARGET_BAND.low + PITCH_TARGET_BAND.high) / 2 },
  'out-mid': { x: PITCH_TARGET_BAND.side, y: (PITCH_TARGET_BAND.low + PITCH_TARGET_BAND.high) / 2 },
  'in-high': { x: -PITCH_TARGET_BAND.side, y: PITCH_TARGET_BAND.high },
  'mid-high': { x: 0, y: PITCH_TARGET_BAND.high },
  'out-high': { x: PITCH_TARGET_BAND.side, y: PITCH_TARGET_BAND.high },
}
export type ZonePoint = keyof typeof ZONE

/** Where a pitch of `type` at zone point `zone`, as `side` sees it, is when it reaches `depth` (field meters). */
export function pitchAt(type: PitchTypeId, zone: ZonePoint, depth: number, side: BattingSide): Vec3 {
  const target = ZONE[zone]
  const plan = planPitch(type, 0.5, { x: side === 'right' ? target.x : -target.x, y: target.y })
  return pitchPosition(plan, secondsAtDepth(plan, depth))
}

/** A swing the tests play: what it is, how it starts, the game ms it is checked at, and the windup's load then. */
export type Scenario = {
  name: string
  start: (batter: Batter) => void
  frames: number[]
  load: (nowMs: number) => number
}

/** Game ms from `from` up to `to`, `step` apart. */
export function framesBetween(from: number, to: number, step: number) {
  return Array.from({ length: Math.floor((to - from) / step) + 1 }, (_, index) => from + index * step)
}

/** Game ms a swing meeting its ball at `contactMs` is checked at: closest round its contact, as the bat rolls over. */
export function swingFrames(fromMs: number, contactMs: number) {
  return [
    ...framesBetween(fromMs, contactMs - 20, 5),
    ...framesBetween(contactMs - 20, contactMs + 60, 1.5),
    ...framesBetween(contactMs + 62, contactMs + 150, 4),
    ...framesBetween(contactMs + 160, contactMs + FOLLOW_MS, 15),
  ]
}

/** A swing from the windup at `load`, taken at 0, its bat meeting `point` (null: a miss) CONTACT_DELAY_MS later. */
export function swingScenario(name: string, point: Vec3 | null, load: number): Scenario {
  const start = (batter: Batter) => {
    batter.swing = NO_SWING
    judgeSwing(batter, 0, 0, CONTACT_DELAY_MS, point, load)
  }
  return { name, start, frames: swingFrames(0, CONTACT_DELAY_MS), load: () => load }
}

/** The windup with its waggle, from the stance to the front foot down. */
export function windupScenario(): Scenario {
  const frames = framesBetween(0, 1000, 50)
  return { name: 'the windup', start: (batter) => (batter.swing = NO_SWING), frames, load: (nowMs) => nowMs / 1000 }
}

/**
 * A miss's held finish, its way back to the stance, and the waggle fading back in: closest where the bat unwinds past
 * the hands and where it is lifted back over the shoulder.
 */
export function returnScenario(): Scenario {
  const frames = [
    ...framesBetween(SWING_MS, SWING_MS + 840, 20),
    ...framesBetween(SWING_MS + 842, SWING_MS + 960, 2),
    ...framesBetween(SWING_MS + 980, SWING_MS + 1270, 20),
    ...framesBetween(SWING_MS + 1272, SWING_MS + 1430, 2),
    ...framesBetween(SWING_MS + 1450, RETURNED_MS + WAGGLE_FADE_MS, 25),
  ]
  const { start } = swingScenario('', null, 1)
  return { name: 'the held finish and the way back', start, frames, load: (nowMs) => (nowMs < RETURNED_MS ? 1 : 0) }
}

/** How a swing the camera saw begin is judged: taken at `takenMs`, its last stretch from `takenMs + afterMs`. */
export type Judging = { takenMs: number; afterMs: number }

/** A swing begun at 0 to be ready by `readyMs`, aimed at `aim`, then judged as `judging` to meet `point`. */
export function begunScenario(name: string, readyMs: number, aim: Vec3, point: Vec3, judging: Judging): Scenario {
  const { seconds, rate } = begunSwingState(0, readyMs, judging.takenMs)
  const throughMs = judging.takenMs + judging.afterMs
  const contactMs = throughMs + lastStretchMs(seconds, rate)
  const start = (batter: Batter) => {
    batter.swing = NO_SWING
    beginSwing(batter, 0, readyMs, 1, aim)
    judgeSwing(batter, judging.takenMs, throughMs, contactMs, point, 1)
  }
  return { name, start, frames: swingFrames(0, contactMs), load: () => 1 }
}

/** A swing begun at 0 to be ready by `readyMs`, aimed at `aim`, and checked at `checkedMs` (never: Infinity). */
export function checkScenario(name: string, readyMs: number, aim: Vec3, checkedMs: number): Scenario {
  const backMs = readyMs + BEGUN_SWING.easeMs + 400
  const start = (batter: Batter) => {
    batter.swing = NO_SWING
    beginSwing(batter, 0, readyMs, 1, aim)
    checkSwing(batter, checkedMs, 1)
  }
  return { name, start, frames: framesBetween(0, backMs + 100, 3), load: () => 1 }
}

/**
 * A swing begun at 0 toward `aim`, checked on its way to the slot, and judged after all on its way back at `takenMs`,
 * to meet `point` 46 ms on.
 */
export function judgedOnItsWayBack(
  name: string,
  readyMs: number,
  aim: Vec3,
  point = aim,
  takenMs = readyMs + 250,
): Scenario {
  const contactMs = takenMs + CONTACT_DELAY_MS
  const start = (batter: Batter) => {
    batter.swing = NO_SWING
    beginSwing(batter, 0, readyMs, 1, aim)
    checkSwing(batter, readyMs + 60, 1)
    judgeSwing(batter, takenMs, takenMs, contactMs, point, 1)
  }
  return { name, start, frames: swingFrames(0, contactMs), load: () => 1 }
}

/** The swings the camera saw begin, checked, and judged on their way, that the default and the plain bob play. */
export function begunScenarios(side: BattingSide): Scenario[] {
  const readyMs = 90
  const { easeMs } = BEGUN_SWING
  const aim = pitchAt('fastball', 'out-high', CONTACT_DEPTH, side)
  return [
    checkScenario('a swing begun and never judged', readyMs, aim, Infinity),
    checkScenario('a swing begun and checked on its way', readyMs, aim, 70),
    checkScenario('a swing begun and checked easing into the slot', readyMs, aim, readyMs + easeMs - 5),
    judgedOnItsWayBack('a swing checked and judged on its way back', readyMs, aim),
    judgedOnItsWayBack(
      'a swing checked and judged on its way back, out front',
      readyMs,
      pitchAt('curve', 'mid-high', CONTACT_DEPTH, side),
      pitchAt('curve', 'mid-high', 0.75, side),
      readyMs + 310,
    ),
    begunScenario(
      'a begun swing judged before it is ready, early and out',
      readyMs,
      aim,
      pitchAt('changeup', 'out-low', 0.82, side),
      { takenMs: 30, afterMs: 20 },
    ),
    begunScenario(
      'a begun swing judged easing, high and out',
      readyMs,
      aim,
      pitchAt('fastball', 'out-high', 0.82, side),
      { takenMs: readyMs + 40, afterMs: 0 },
    ),
    begunScenario(
      'a begun swing judged late, the clock stepped back, out front',
      readyMs,
      aim,
      pitchAt('curve', 'out-mid', 0.82, side),
      { takenMs: readyMs + 70, afterMs: -70 },
    ),
    begunScenario(
      'a begun swing judged going back, late and in',
      readyMs,
      aim,
      pitchAt('curve', 'in-low', -0.21, side),
      { takenMs: readyMs + easeMs + 70, afterMs: 0 },
    ),
    begunScenario(
      'a swing begun for a ball due soon, PERFECT',
      46,
      pitchAt('fastball', 'middle', CONTACT_DEPTH, side),
      pitchAt('fastball', 'middle', CONTACT_DEPTH, side),
      { takenMs: 36, afterMs: 0 },
    ),
  ]
}

/**
 * The pitches every look meets (type, zone point, m in front of the plate's center it is met): the zone's corners and
 * edges at the front of the reach (0.82, where a swing about 0.2 s early meets it), where the arms stretch furthest;
 * PERFECT at the middle and outside, where the knob and a bob's side hair come nearest; and low and inside late, where
 * a brim does, to the back of the reach (-0.21, about 0.2 s late).
 */
export const PITCH_GRID: [PitchTypeId, ZonePoint, number][] = [
  ['fastball', 'mid-low', 0.82],
  ['changeup', 'mid-low', 0.82],
  ['fastball', 'out-low', 0.82],
  ['curve', 'out-high', 0.82],
  ['fastball', 'in-low', 0.62],
  ['changeup', 'out-high', 0.62],
  ['fastball', 'middle', CONTACT_DEPTH],
  ['curve', 'out-mid', CONTACT_DEPTH],
  ['changeup', 'in-low', 0],
  ['curve', 'in-low', -0.21],
]

/**
 * The swings every look plays on `side`: the windup, the way back, a practice swing at nothing (from the stance batting
 * right, from halfway through the windup batting left), an early ball met with the stride not yet down, and the grid.
 */
export function gridScenarios(side: BattingSide): Scenario[] {
  const pitched = PITCH_GRID.map(([type, zone, depth]) =>
    swingScenario(`${type} ${zone} met ${depth.toFixed(2)} m out`, pitchAt(type, zone, depth, side), 1),
  )
  return [
    windupScenario(),
    returnScenario(),
    swingScenario('a practice swing at nothing', null, side === 'right' ? 0 : 0.5),
    swingScenario('out front with the stride not yet down', pitchAt('fastball', 'out-low', 0.82, side), 0.9),
    ...pitched,
  ]
}

/** The deepest the batter sinks into itself over `scenario`, which pair and when, and the most it stretches an arm. */
export function worstOf(batter: Batter, scenario: Scenario) {
  scenario.start(batter)
  const frames = scenario.frames.map((nowMs) => {
    poseBatter(batter, batterPoseAt(batter, nowMs, scenario.load(nowMs), true))
    const overlaps = batterOverlaps(batter)
    const pair = OVERLAP_PAIRS.reduce((deepest, next) => (overlaps[next] > overlaps[deepest] ? next : deepest))
    return { nowMs, depth: overlaps[pair], pair, stretch: armStretch(batter) }
  })
  const deepest = frames.reduce((worst, frame) => (frame.depth > worst.depth ? frame : worst))
  const stretched = frames.reduce((worst, frame) => (frame.stretch > worst.stretch ? frame : worst))
  return {
    depth: deepest.depth,
    where: `${scenario.name}: ${deepest.pair} at ${deepest.nowMs} ms`,
    stretch: stretched.stretch,
    stretchedAt: `${scenario.name} at ${stretched.nowMs} ms`,
  }
}
