import { describe, expect, it } from 'vitest'
import { createSeededRandom } from '../game/seededRandom'
import type { Detection } from '../vision/heldObject'
import { NO_ENERGY } from '../vision/motionEnergy'
import type { BodySample, Hand, Point } from '../vision/poseLandmarks'
import {
  CAPTION_HOLD_MS,
  createSwingTracker,
  stepTracking,
  type SwingTracker,
  type TrackerState,
  updateSwingTracker,
} from '../vision/swingTracker'
import {
  followStance,
  holdStance,
  nextShownNeed,
  type PoseNeed,
  STANCE_HOLD_RULES,
  type StanceFrame,
  stanceFrame,
  stanceHeld,
  type StanceHold,
  stanceProgress,
  type StanceWait,
  type StanceWatch,
  startStanceHold,
  watchStance,
} from './stanceHold'

const FRAME_MS = 1000 / 30
const GRIP: Point = { x: 0.4, y: 0.5 }
const WIDTH = 0.2
const { holdMs, settleMs, graceMs } = STANCE_HOLD_RULES
const SETUP: StanceWait = { key: 'setup@0', afterSwings: false }
const PRACTICE_DONE: StanceWait = { key: 'practiceDone@0', afterSwings: true }

/** What the hold sees: what the pose lacks of the stance (nothing by default), the grip over time, the shoulders. */
type Scene = { pose?: PoseNeed | null; grip?: (time: number) => Point | null; shoulderWidth?: number }

const handsDown: Scene = { pose: 'raise' }
const lost: Scene = { grip: () => null }

/** The frames from `fromMs` to `toMs` at 30 fps; a frame with no grip is one the camera lost the visitor in. */
function frames(fromMs: number, toMs: number, { pose = null, grip = () => GRIP, shoulderWidth = WIDTH }: Scene = {}) {
  const count = Math.round((toMs - fromMs) / FRAME_MS)
  return Array.from({ length: count }, (_, index): StanceFrame => {
    const time = fromMs + index * FRAME_MS
    const seen = grip(time)
    return seen ? { time, pose, grip: seen, shoulderWidth } : { time, pose: 'show', grip: null, shoulderWidth: null }
  })
}

function watch(hold: StanceHold, scenes: StanceFrame[][]) {
  return scenes.flat().reduce(holdStance, hold)
}

/** A grip swaying `amplitude` (image units) either way of GRIP, once a second. */
function swaying(amplitude: number) {
  return (time: number) => ({ x: GRIP.x + amplitude * Math.sin((2 * Math.PI * time) / 1000), y: GRIP.y })
}

/**
 * A still visitor's grip as the pose task reports it, shaped after the drafts' real webcam log: each frame strays
 * independently by up to 0.1 SW across and 0.13 SW up or down (about the log's 0.05 and 0.07 SW standard deviation, so
 * some frames jump 0.25 SW), over a slow drift of 0.1 SW. Over half a second the raw grip strays 0.2–0.3 SW from its
 * middle, as in the log.
 */
function jittering(seed: number, shoulderWidth: number) {
  const random = createSeededRandom(seed)
  return (time: number) => ({
    x: GRIP.x + shoulderWidth * (0.1 * Math.sin((2 * Math.PI * time) / 2000) + 0.2 * (random() - 0.5)),
    y: GRIP.y + shoulderWidth * 0.26 * (random() - 0.5),
  })
}

/** The hold as the vision loop keeps it between frames, with the progress it last reported. */
type Watched = { hold: StanceHold | null; shown: number }

function watchFrames(start: Watched, scene: StanceFrame[], stance: StanceWatch) {
  return scene.reduce<Watched>(({ hold, shown }, frame) => {
    const next = watchStance(hold, true, frame, stance, shown)
    return { hold: next, shown: stanceProgress(next) }
  }, start)
}

describe('the stance hold', () => {
  it('fills over three seconds of a stance the visitor already stands in when the setup asks, and stays full', () => {
    const almost = watch(startStanceHold(SETUP, 0), [frames(0, settleMs + holdMs - 100)])
    expect(stanceHeld(almost)).toBe(false)
    expect(stanceProgress(almost)).toBeGreaterThan(0.95)
    const full = watch(almost, [frames(settleMs + holdMs - 100, settleMs + holdMs + 100)])
    expect(stanceHeld(full)).toBe(true)
    expect(stanceHeld(watch(full, [frames(settleMs + holdMs + 100, settleMs + holdMs + 1500, handsDown)]))).toBe(true)
  })

  it("counts nothing in the step's first second, then counts every moment held", () => {
    const early = watch(startStanceHold(SETUP, 0), [frames(0, settleMs - FRAME_MS)])
    expect(stanceProgress(early)).toBe(0)
    expect(watch(early, [frames(settleMs - FRAME_MS, settleMs + 500)]).heldMs).toBeCloseTo(500, -2)
  })

  it('right after swings, counts a stance kept from the last swing only once the hands drop or move', () => {
    const kept = watch(startStanceHold(PRACTICE_DONE, 0), [frames(0, 8000)])
    expect([stanceProgress(kept), kept.need]).toEqual([0, 'retake'])
    // A camera that loses the visitor for a moment, or misreads their hands for less than 300 ms, has not seen them
    // take a fresh stance.
    const unseen = watch(kept, [frames(8000, 8500, lost)])
    expect(unseen.need).toBe('show')
    const flickered = watch(unseen, [frames(8500, 9000 + holdMs)])
    expect([stanceProgress(flickered), flickered.need]).toEqual([0, 'retake'])
    const glitched = watch(kept, [frames(8000, 8000 + graceMs - 50, handsDown), frames(8000 + graceMs - 50, 12000)])
    expect([stanceProgress(glitched), glitched.need]).toEqual([0, 'retake'])
    const lowered = watch(kept, [frames(8000, 8500, handsDown), frames(8500, 8600 + holdMs)])
    expect(stanceHeld(lowered)).toBe(true)
    // Shifting the hands a shoulder width and back, still in the stance, takes it afresh too.
    const shifted = { grip: () => ({ x: GRIP.x - WIDTH, y: GRIP.y }) }
    const moved = watch(kept, [frames(8000, 8300, shifted), frames(8300, 9000 + holdMs)])
    expect(stanceHeld(moved)).toBe(true)
  })

  it("right after swings, asks hands lowered to the picture's edge for the stance again, not to step back", () => {
    // A webcam framed from the head down sees lowered hands at its bottom edge, as the retake line asks for them.
    const atTheEdge: Scene = { pose: 'handsInView' }
    const kept = watch(startStanceHold(PRACTICE_DONE, 0), [frames(0, 2000)])
    const lowering = frames(2000, 3000, atTheEdge).reduce<StanceHold[]>(
      (holds, frame) => [...holds, holdStance(holds.at(-1) ?? kept, frame)],
      [],
    )
    const needs = [...new Set(lowering.map((hold) => hold.need))]
    expect(needs).toEqual(['retake', 'raise'])
    expect(stanceHeld(watch(lowering.at(-1) ?? kept, [frames(3000, 3100 + holdMs)]))).toBe(true)
    // On the setup the same hands are asked into the picture.
    expect(watch(startStanceHold(SETUP, 0), [frames(0, 2000, atTheEdge)]).need).toBe('handsInView')
  })

  it('neither fills nor drains through a break or a loss under 300 ms, and drains as fast as it fills after', () => {
    const twoSeconds = watch(startStanceHold(SETUP, 0), [frames(0, settleMs + 2000)])
    expect(twoSeconds.heldMs).toBeCloseTo(2000, -2)
    for (const broken of [handsDown, lost]) {
      const brief = watch(twoSeconds, [frames(settleMs + 2000, settleMs + 2000 + graceMs - 50, broken)])
      expect(brief.heldMs).toBe(twoSeconds.heldMs)
      // A second's break drains what it lasted past the grace; holding as long again fills it back.
      const real = watch(twoSeconds, [frames(settleMs + 2000, settleMs + 3000, broken)])
      expect(real.heldMs).toBeCloseTo(twoSeconds.heldMs - (1000 - graceMs), -2)
      const back = watch(real, [frames(settleMs + 3000, settleMs + 3000 + 1000 - graceMs)])
      expect(back.heldMs).toBeCloseTo(twoSeconds.heldMs, -2)
    }
  })

  it("holds through the pose task's jitter on a still visitor, near the camera or far from it, but not a sway", () => {
    const jittered = (shoulderWidth: number) =>
      watch(startStanceHold(SETUP, 0), [frames(0, settleMs + holdMs + 100, { grip: jittering(7, shoulderWidth) })])
    expect(stanceHeld(jittered(0.3))).toBe(true)
    expect(stanceHeld(jittered(0.1))).toBe(true)
    // The same sway in the picture: small beside a near visitor's shoulders, half a shoulder width a far one's.
    const swayed = (shoulderWidth: number) =>
      watch(startStanceHold(SETUP, 0), [frames(0, 6000, { grip: swaying(0.06), shoulderWidth })])
    expect(stanceHeld(swayed(0.3))).toBe(true)
    expect([stanceProgress(swayed(0.1)), swayed(0.1).need]).toEqual([0, 'still'])
  })

  it('says the first thing the stance lacks, and to keep holding through a brief break', () => {
    const needAfter = (scene: Scene) => watch(startStanceHold(SETUP, 0), [frames(0, 2000, scene)]).need
    expect(needAfter(lost)).toBe('show')
    expect(needAfter({ pose: 'together' })).toBe('together')
    expect(needAfter(handsDown)).toBe('raise')
    expect(needAfter({ grip: swaying(0.06), shoulderWidth: 0.1 })).toBe('still')
    // In the step's first second the gauge does not move, so the line says it is getting ready, not to keep holding,
    // unless something else is missing.
    const settling = watch(startStanceHold(SETUP, 0), [frames(0, 500)])
    expect([settling.need, stanceProgress(settling)]).toEqual(['settle', 0])
    expect(watch(startStanceHold(SETUP, 0), [frames(0, 500, handsDown)]).need).toBe('raise')
    const holding = watch(startStanceHold(SETUP, 0), [frames(0, 2000)])
    expect(holding.need).toBe('hold')
    expect(watch(holding, [frames(2000, 2000 + graceMs - 50, handsDown)]).need).toBe('hold')
    expect(watch(holding, [frames(2000, 2000 + graceMs + 50, handsDown)]).need).toBe('raise')
  })

  it('tells the page once that a hold filled, though it stays full, and starts the next step that waits at nothing', () => {
    const heard = { progress: [] as number[], held: [] as string[] }
    const watching = (wait: StanceWait): StanceWatch => ({
      wait,
      onProgress: (progress) => heard.progress.push(progress),
      onHeld: () => heard.held.push(wait.key),
    })
    const full = watchFrames({ hold: null, shown: 0 }, frames(0, settleMs + holdMs + 100), watching(SETUP))
    const stillFull = watchFrames(full, frames(settleMs + holdMs + 100, settleMs + holdMs + 200), watching(SETUP))
    expect([stanceHeld(stillFull.hold), heard.held]).toEqual([true, ['setup@0']])
    const reported = heard.progress.length
    const later: StanceWait = { key: 'practiceDone@9000', afterSwings: true }
    const stance = [...frames(9000, 9500, handsDown), ...frames(9500, 9600 + settleMs + holdMs)]
    const next = watchFrames(stillFull, stance, watching(later))
    expect(heard.progress[reported]).toBe(0)
    expect([stanceHeld(next.hold), heard.held]).toEqual([true, ['setup@0', 'practiceDone@9000']])
  })

  it('starts afresh for each step that waits, and holds nothing while none does', () => {
    const [first] = frames(0, FRAME_MS)
    const full = { ...startStanceHold(SETUP, 0), heldMs: holdMs }
    const next = followStance(full, { key: 'result@9000', afterSwings: true }, { ...first, time: 9000 })
    expect([stanceHeld(next), next?.since, next?.armed]).toEqual([false, 9000, false])
    expect(followStance(full, null, first)).toBe(null)
  })

  it('changes the line under the gauge only once the need it shows has stood a while, so it never flickers', () => {
    const raise = nextShownNeed(null, 'raise', 0)
    expect(nextShownNeed(raise, 'still', CAPTION_HOLD_MS - 1)).toBe(raise)
    expect(nextShownNeed(raise, 'still', CAPTION_HOLD_MS)?.need).toBe('still')
    expect(nextShownNeed(raise, null, 100)).toBe(null)
  })
})

/** Shoulders 0.2 wide at height 0.4 about x 0.6: a right-handed batter's back shoulder is at x 0.5, image left. */
const SHOULDERS = { width: WIDTH, midX: 0.6, midY: 0.4 }

type TrackerOptions = { wrists?: BodySample['wrists']; hand?: Hand; state?: TrackerState; side?: 'right' | 'left' }

/** A tracker in `state` following `grip` between `wrists`, held in `hand`, for a batter on `side`. */
function trackerAt(
  grip: Point,
  { wrists = { left: grip, right: grip }, hand = 'both', state = 'locked', side = 'right' }: TrackerOptions = {},
): SwingTracker {
  const tracker = createSwingTracker(side)
  Object.assign(tracker, { state, hand, frame: { samples: [SHOULDERS], frontal: SHOULDERS } })
  tracker.view = { wrists, head: null, grip, source: hand, width: WIDTH, midX: SHOULDERS.midX }
  return tracker
}

describe('the batting stance', () => {
  const byTheBackShoulder = { x: 0.5, y: 0.45 }

  it('is the grip up by the back shoulder, whatever state the swing tracker is in once it has locked', () => {
    const states: TrackerState[] = ['locked', 'loaded', 'sweeping', 'cooldown']
    expect(states.map((state) => stanceFrame(trackerAt(byTheBackShoulder, { state }), 0).pose)).toEqual(
      states.map(() => null),
    )
    // Before the lock the tracker could not follow a swing, so the stance waits for it.
    expect(stanceFrame(trackerAt(byTheBackShoulder, { state: 'searching' }), 0).pose).toBe('lock')
    expect(stanceFrame(trackerAt(byTheBackShoulder), 0)).toMatchObject({
      grip: byTheBackShoulder,
      shoulderWidth: WIDTH,
    })
    // At the hip, by the front shoulder, or by the back shoulder of the other side, it waits to be raised.
    const atTheHip = { x: 0.5, y: SHOULDERS.midY + WIDTH * 1.5 }
    const byTheFrontShoulder = { x: 0.7, y: 0.45 }
    expect(stanceFrame(trackerAt(atTheHip), 0).pose).toBe('raise')
    expect(stanceFrame(trackerAt(byTheFrontShoulder), 0).pose).toBe('raise')
    expect(stanceFrame(trackerAt(byTheFrontShoulder, { side: 'left' }), 0).pose).toBe(null)
  })

  it('counts the grip only as far back as the swing tracker loads, so a held stance is one it swings from', () => {
    const read = [0.2, 0.24, 0.26, 0.4].map((depth) => {
      const tracker = trackerAt({ x: SHOULDERS.midX - depth * WIDTH, y: 0.45 })
      stepTracking(tracker, tracker.view, 0)
      return { counted: stanceFrame(tracker, 0).pose === null, loaded: tracker.state === 'loaded' }
    })
    expect(read.map(({ counted }) => counted)).toEqual([false, false, true, true])
    expect(read.map(({ loaded }) => loaded)).toEqual(read.map(({ counted }) => counted))
  })

  it('needs both hands together when both hold the object, and only the holding hand when one does', () => {
    const hanging = { left: { x: 0.75, y: 0.8 }, right: { x: 0.45, y: 0.8 } }
    expect(stanceFrame(trackerAt({ x: 0.6, y: 0.8 }, { wrists: hanging }), 0).pose).toBe('together')
    const freeHandDown = { left: { x: 0.75, y: 0.8 }, right: byTheBackShoulder }
    expect(stanceFrame(trackerAt(byTheBackShoulder, { wrists: freeHandDown, hand: 'right' }), 0).pose).toBe(null)
    // One wrist hidden behind the other is still a grip.
    const oneHidden = { left: null, right: byTheBackShoulder }
    expect(stanceFrame(trackerAt(byTheBackShoulder, { wrists: oneHidden }), 0).pose).toBe(null)
  })

  it('asks for the hands inside the picture before anything else it reads from them', () => {
    // The pose task guesses a wrist below the picture's bottom edge: hands low and apart, before the lock.
    const belowPicture = { left: { x: 0.75, y: 1.08 }, right: { x: 0.45, y: 0.97 } }
    const guessed = { x: 0.6, y: 1.02 }
    expect(stanceFrame(trackerAt(guessed, { wrists: belowPicture, state: 'searching' }), 0).pose).toBe('handsInView')
    expect(stanceFrame(trackerAt(guessed, { wrists: belowPicture }), 0).pose).toBe('handsInView')
    // By the picture's left or right edge too; the same hands well inside it are told what else they lack.
    const byTheEdge = { left: { x: 0.03, y: 0.45 }, right: { x: 0.05, y: 0.45 } }
    expect(stanceFrame(trackerAt({ x: 0.04, y: 0.45 }, { wrists: byTheEdge }), 0).pose).toBe('handsInView')
    // The right edge is the picture's width away (x is scaled by the 4:3 aspect), and the top edge counts too.
    const byTheRightEdge = { x: 4 / 3 - 0.03, y: 0.45 }
    expect(stanceFrame(trackerAt(byTheRightEdge, { side: 'left' }), 0).pose).toBe('handsInView')
    const leftBackShoulder = { x: 1, y: 0.45 }
    expect(stanceFrame(trackerAt(leftBackShoulder, { side: 'left' }), 0).pose).toBe(null)
    expect(stanceFrame(trackerAt({ x: 0.5, y: 0.02 }), 0).pose).toBe('handsInView')
    const hanging = { left: { x: 0.75, y: 0.8 }, right: { x: 0.45, y: 0.8 } }
    expect(stanceFrame(trackerAt({ x: 0.6, y: 0.8 }, { wrists: hanging }), 0).pose).toBe('together')
    // Only the hands the grip follows: a free hand hanging out of the picture does not hold up a one-handed stance.
    const freeHandOut = { left: { x: 0.75, y: 1.05 }, right: byTheBackShoulder }
    expect(stanceFrame(trackerAt(byTheBackShoulder, { wrists: freeHandOut, hand: 'right' }), 0).pose).toBe(null)
  })

  it('keeps filling through a lock that lands mid-hold, though the grip then follows the hand that holds it', () => {
    // On the setup step, the left hand by the back shoulder and the right hidden behind it, so the hands play free;
    // a second into the hold, the detector finds a bottle in the left hand, which the grip follows from then on.
    const tracker = createSwingTracker('right')
    tracker.settingUp = true
    const body: BodySample = {
      wrists: { left: byTheBackShoulder, right: null },
      shoulders: SHOULDERS,
      head: null,
      aspect: 4 / 3,
    }
    const bottle: Detection = { label: 'bottle', score: 0.8, box: { x: 0.36, y: 0.17, width: 0.03, height: 0.28 } }
    const times = Array.from({ length: Math.round(6000 / FRAME_MS) }, (_, index) => index * FRAME_MS)
    const seen = times.reduce<{ hold: StanceHold; hand: Hand }[]>((frames, time, index) => {
      const holdingSince = frames.findIndex(({ hold }) => hold.need === 'hold')
      const found = holdingSince >= 0 && time - times[holdingSince] > 1000 ? [bottle] : []
      updateSwingTracker(tracker, { time, body, detections: index % 3 === 0 ? found : null, energy: NO_ENERGY })
      const hold = holdStance(frames.at(-1)?.hold ?? startStanceHold(SETUP, 0), stanceFrame(tracker, time))
      return [...frames, { hold, hand: tracker.hand }]
    }, [])
    expect(tracker.lock?.kind).toBe('detected')
    const relocked = seen.find(({ hand }) => hand === 'left')?.hold
    expect(stanceProgress(relocked ?? null)).toBeGreaterThan(0.3)
    expect(stanceHeld(relocked ?? null)).toBe(false)
    const held = seen.map(({ hold }) => hold.heldMs)
    expect(held.every((heldMs, index) => heldMs >= (held[index - 1] ?? 0))).toBe(true)
    expect(stanceHeld(seen.at(-1)?.hold ?? null)).toBe(true)
  })

  it('waits for the upper body while the tracker has no grip, or only holds the last one it saw', () => {
    const unseen = trackerAt(byTheBackShoulder)
    unseen.view = null
    expect(stanceFrame(unseen, 0)).toEqual({ time: 0, pose: 'show', grip: null, shoulderWidth: null })
    const held = trackerAt(byTheBackShoulder)
    held.view = { ...held.view!, source: 'hold' }
    expect(stanceFrame(held, 0).pose).toBe('show')
  })
})
