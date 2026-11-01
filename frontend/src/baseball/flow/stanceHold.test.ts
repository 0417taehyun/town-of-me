import { describe, expect, it } from 'vitest'
import type { Point } from '../vision/poseLandmarks'
import { createSwingTracker, type SwingTracker } from '../vision/swingTracker'
import {
  followStance,
  holdStance,
  STANCE_HOLD_RULES,
  type StanceFrame,
  stanceFrame,
  stanceHeld,
  type StanceHold,
  stanceProgress,
  type StanceWatch,
  startStanceHold,
  watchStance,
} from './stanceHold'

const FRAME_MS = 1000 / 30
const GRIP: Point = { x: 0.4, y: 0.5 }
const WIDTH = 0.2

/** What the hold sees from `fromMs` to `toMs` at 30 fps: in or out of the stance, the grip, and the shoulders. */
type Scene = { inStance: boolean; grip?: (time: number) => Point | null; shoulderWidth?: number }

function frames(fromMs: number, toMs: number, { inStance, grip = () => GRIP, shoulderWidth = WIDTH }: Scene) {
  const count = Math.round((toMs - fromMs) / FRAME_MS)
  return Array.from({ length: count }, (_, index): StanceFrame => {
    const time = fromMs + index * FRAME_MS
    const seenGrip = grip(time)
    return { time, inStance: inStance && seenGrip !== null, grip: seenGrip, shoulderWidth: seenGrip && shoulderWidth }
  })
}

function watch(hold: StanceHold, scenes: StanceFrame[][]) {
  return scenes.flat().reduce(holdStance, hold)
}

/** Seen out of the stance for the step's first half second, so a stance after it is a new one. */
const arming = frames(0, 500, { inStance: false })

/** The hold as the vision loop keeps it between frames, with the progress it last reported. */
type Watched = { hold: StanceHold | null; shown: number }

function watchFrames(start: Watched, scene: StanceFrame[], stance: StanceWatch) {
  return scene.reduce<Watched>(({ hold, shown }, frame) => {
    const next = watchStance(hold, true, frame, stance, shown)
    return { hold: next, shown: stanceProgress(next) }
  }, start)
}

describe('the stance hold', () => {
  it('fills over three seconds of a still stance taken once the step has settled, and then stays full', () => {
    const settled = STANCE_HOLD_RULES.settleMs
    const almost = watch(startStanceHold('setup@0', 0), [arming, frames(500, settled + 2900, { inStance: true })])
    expect(stanceHeld(almost)).toBe(false)
    expect(stanceProgress(almost)).toBeGreaterThan(0.95)
    const full = watch(almost, [frames(settled + 2900, settled + 3100, { inStance: true })])
    expect(stanceHeld(full)).toBe(true)
    expect(stanceHeld(watch(full, [frames(settled + 3100, settled + 4000, { inStance: false })]))).toBe(true)
  })

  it('drains at twice its pace when the stance breaks, rather than starting over', () => {
    const settled = STANCE_HOLD_RULES.settleMs
    const twoSeconds = watch(startStanceHold('setup@0', 0), [arming, frames(500, settled + 2000, { inStance: true })])
    expect(twoSeconds.heldMs).toBeCloseTo(2000, -2)
    const broken = watch(twoSeconds, [frames(settled + 2000, settled + 2500, { inStance: false })])
    expect(broken.heldMs).toBeCloseTo(1000, -2)
    const back = watch(broken, [frames(settled + 2500, settled + 4400, { inStance: true })])
    expect(stanceHeld(back)).toBe(false)
    expect(stanceHeld(watch(back, [frames(settled + 4400, settled + 4600, { inStance: true })]))).toBe(true)
  })

  it('never counts a stance kept from before the step asked, until the visitor leaves it and takes it again', () => {
    const kept = watch(startStanceHold('result@0', 0), [frames(0, 8000, { inStance: true })])
    expect(stanceProgress(kept)).toBe(0)
    const retaken = watch(kept, [frames(8000, 8100, { inStance: false }), frames(8100, 11200, { inStance: true })])
    expect(stanceHeld(retaken)).toBe(true)
  })

  it("ignores the step's first moments, so the end of a swing or a celebration starts nothing", () => {
    const early = watch(startStanceHold('practiceDone@0', 0), [
      frames(0, 100, { inStance: false }),
      frames(100, STANCE_HOLD_RULES.settleMs, { inStance: true }),
    ])
    expect(stanceProgress(early)).toBe(0)
  })

  it('measures stillness in the shoulder widths of the visitor, near the camera or far from it', () => {
    // The same wobble in the picture: a small share of a near visitor's shoulders, a large one of a far one's.
    const wobble = (time: number) => ({ x: GRIP.x + (Math.floor(time / 100) % 2 ? 0.02 : -0.02), y: GRIP.y })
    const holdFor = (shoulderWidth: number) =>
      watch(startStanceHold('setup@0', 0), [
        frames(0, 500, { inStance: false, shoulderWidth }),
        frames(500, 6000, { inStance: true, grip: wobble, shoulderWidth }),
      ])
    expect(stanceHeld(holdFor(0.3))).toBe(true)
    expect(stanceProgress(holdFor(0.1))).toBe(0)
  })

  it('keeps the gauge through a tracking dropout of 200 ms and drains through a longer one', () => {
    const settled = STANCE_HOLD_RULES.settleMs
    const filling = watch(startStanceHold('setup@0', 0), [arming, frames(500, settled + 1500, { inStance: true })])
    const lost = (forMs: number) =>
      watch(filling, [frames(settled + 1500, settled + 1500 + forMs, { inStance: false, grip: () => null })])
    expect(lost(150).heldMs).toBe(filling.heldMs)
    expect(lost(600).heldMs).toBeLessThan(filling.heldMs - 500)
  })

  it('tells the page once that a hold filled, though it stays full, and starts the next step that waits at nothing', () => {
    const heard = { progress: [] as number[], held: [] as string[] }
    const watching = (wait: string): StanceWatch => ({
      wait,
      onProgress: (progress) => heard.progress.push(progress),
      onHeld: () => heard.held.push(wait),
    })
    const settled = STANCE_HOLD_RULES.settleMs
    const stanceFor = (fromMs: number) => [
      ...frames(fromMs, fromMs + 500, { inStance: false }),
      ...frames(fromMs + 500, fromMs + settled + 3300, { inStance: true }),
    ]
    const full = watchFrames({ hold: null, shown: 0 }, stanceFor(0), watching('setup@0'))
    const stillFull = watchFrames(full, frames(settled + 3300, settled + 3400, { inStance: true }), watching('setup@0'))
    expect([stanceHeld(stillFull.hold), heard.held]).toEqual([true, ['setup@0']])
    const reported = heard.progress.length
    const next = watchFrames(stillFull, stanceFor(9000), watching('practiceDone@9000'))
    expect(heard.progress[reported]).toBe(0)
    expect([stanceHeld(next.hold), heard.held]).toEqual([true, ['setup@0', 'practiceDone@9000']])
  })

  it('starts afresh for each step that waits, and holds nothing while none does', () => {
    const [first] = frames(0, FRAME_MS, { inStance: true })
    const full = { ...startStanceHold('setup@0', 0), heldMs: STANCE_HOLD_RULES.holdMs }
    const next = followStance(full, 'practiceDone@9000', { ...first, time: 9000 })
    expect([stanceHeld(next), next?.since]).toEqual([false, 9000])
    expect(followStance(full, null, first)).toBe(null)
  })
})

/** A tracker following a visitor whose shoulders are 0.2 wide at height 0.4, its grip at `grip`, in `state`. */
function trackerAt(state: SwingTracker['state'], grip: Point): SwingTracker {
  const tracker = createSwingTracker('right', true)
  const shoulders = { width: WIDTH, midX: 0.6, midY: 0.4 }
  tracker.state = state
  tracker.frame = { samples: [shoulders], frontal: shoulders }
  tracker.view = { wrists: { left: grip, right: grip }, head: null, grip, source: 'both', width: WIDTH, midX: 0.6 }
  return tracker
}

describe('the batting stance', () => {
  it('is the tracker loaded on the batting side with the grip up by the shoulders, not hanging at the hip', () => {
    const byTheShoulder = { x: 0.5, y: 0.45 }
    const atTheHip = { x: 0.5, y: 0.4 + WIDTH * 1.5 }
    expect(stanceFrame(trackerAt('loaded', byTheShoulder), 0).inStance).toBe(true)
    expect(stanceFrame(trackerAt('loaded', atTheHip), 0).inStance).toBe(false)
    expect(stanceFrame(trackerAt('locked', byTheShoulder), 0).inStance).toBe(false)
    expect(stanceFrame(trackerAt('searching', byTheShoulder), 0)).toMatchObject({ grip: byTheShoulder })
  })
})
