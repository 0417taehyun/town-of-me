import { describe, expect, it } from 'vitest'
import type { BattingSide } from '../game/field'
import { STRIKE_ZONE } from '../game/field'
import { type Detection, HELD_OBJECT_RULES } from './heldObject'
import type { Energy } from './motionEnergy'
import { bodySample, type Keypoints } from './poseLandmarks'
import {
  CAPTION_HOLD_MS,
  CONTACT_HEIGHT,
  createSwingTracker,
  type HeldCaption,
  lockByHand,
  nextCaption,
  notify,
  objectMark,
  SWEEP_FAILURE_REASONS,
  SWING_RULES,
  type SwingCue,
  type SwingTracker,
  type TrackedSwing,
  type TrackerReason,
  updateSwingTracker,
} from './swingTracker'

// Synthetic 30 fps camera frames, made here and nowhere else: a visitor one step back facing the camera, shoulders
// 0.15 of the picture apart around x = 0.5, so one shoulder width (SW) is 0.15 of the width and 0.2 of the height. In
// the raw, unmirrored picture a right-handed batter's back shoulder is on the left, so they load at x < 0.5.

const ASPECT = 4 / 3
const FRAME_MS = 1000 / 30
const SHOULDER_Y = 0.35
const SHOULDER_WIDTH_X = 0.15
const SHOULDER_WIDTH_Y = SHOULDER_WIDTH_X * ASPECT
/** The grip height that swings the bat level through the middle of the strike zone. */
const LEVEL_Y = SHOULDER_Y + CONTACT_HEIGHT.levelDrop * SHOULDER_WIDTH_Y
const LOAD = -0.6
const QUIET: Energy = { value: 1, moving: 0.01 }
const LOUD: Energy = { value: 12, moving: 0.25 }
/** Plenty of the band changing, but each pixel barely: a sweep the camera hardly saw. */
const DIM: Energy = { value: 2, moving: 0.1 }

/** The shoulders' width (a share of the frontal width) and their midpoint's shift (SW): the torso turned or not. */
type Torso = { width: number; shift: number }
const FRONTAL: Torso = { width: 1, shift: 0 }
/** Turned to load: a right-handed batter's shoulders narrowed and their midpoint dragged toward the back. */
const TURNED: Torso = { width: 0.3, shift: -0.3 }
/** Holding one-handed, the free hand hangs this far (SW) below the grip. */
const FREE_HAND_DROP = 0.7

/**
 * The grip at `offset` SW from the body's midline, the body standing at `centre`: both hands together (`armsApart` SW
 * apart, around the grip), or the right hand alone (`oneHanded`) with the left below it; `gripSeen` hides the right
 * wrist alone.
 */
type Pose = {
  offset: number
  gripY?: number
  centre?: number
  wristsSeen?: boolean
  torso?: Torso
  oneHanded?: boolean
  gripSeen?: boolean
  armsApart?: number
}
/** What the stage heard of the tracker on a frame at `at`: a cue, or a swing reported. */
type Heard = { at: number; heard: SwingCue | TrackedSwing }
type Run = {
  tracker: SwingTracker
  swings: TrackedSwing[]
  heard: Heard[]
  time: number
  frames: number
  shown: HeldCaption | null
  captions: TrackerReason[]
}
/** The object detector, when it runs: finding the bottle in the hands, or nothing. */
type StepOptions = { energy?: Energy; detector?: 'bottle' | 'nothing' }

function keypointsFor(pose: Pose): Keypoints {
  const { offset, gripY = LEVEL_Y, centre = 0.5, wristsSeen = true, torso = FRONTAL, oneHanded = false } = pose
  const gripX = centre + offset * SHOULDER_WIDTH_X
  const wristScore = wristsSeen ? 0.9 : 0.1
  const shouldersX = centre + torso.shift * SHOULDER_WIDTH_X
  const halfWidth = (torso.width * SHOULDER_WIDTH_X) / 2
  const together = pose.armsApart === undefined ? 0.008 : (pose.armsApart * SHOULDER_WIDTH_X) / 2
  const apart = oneHanded ? 0 : together
  return {
    nose: { x: centre, y: 0.2, score: 0.95 },
    leftShoulder: { x: shouldersX + halfWidth, y: SHOULDER_Y, score: 0.95 },
    rightShoulder: { x: shouldersX - halfWidth, y: SHOULDER_Y, score: 0.95 },
    leftElbow: null,
    rightElbow: null,
    leftWrist: { x: gripX + apart, y: gripY + (oneHanded ? FREE_HAND_DROP * SHOULDER_WIDTH_Y : 0), score: wristScore },
    rightWrist: { x: gripX - apart, y: gripY, score: pose.gripSeen === false ? 0.1 : wristScore },
  }
}

/** A bottle standing up out of the hands at `pose`'s grip, as the detector boxes it. */
function bottleAt({ offset, gripY = LEVEL_Y, centre = 0.5 }: Pose): Detection {
  const gripX = centre + offset * SHOULDER_WIDTH_X
  return { label: 'bottle', score: 0.8, box: { x: gripX - 0.03, y: gripY - 0.28, width: 0.06, height: 0.3 } }
}

function camera(side: BattingSide = 'right'): Run {
  return { tracker: createSwingTracker(side), swings: [], heard: [], time: 1000, frames: 0, shown: null, captions: [] }
}

/** What the detector finds in a frame of `pose` when it runs: the bottle in the hands, or nothing. */
function detectionsFor(pose: Pose, detector: StepOptions['detector']) {
  return detector === 'bottle' ? [bottleAt(pose)] : []
}

/**
 * One frame of `pose` (null: nobody in view); a `detector` runs on every third frame. Each new caption the camera
 * panel would show goes into `captions`.
 */
function step(run: Run, pose: Pose | null, { energy = QUIET, detector }: StepOptions = {}) {
  run.time += FRAME_MS
  run.frames += 1
  const body = pose && bodySample(keypointsFor(pose), ASPECT)
  const detections = pose && detector && run.frames % 3 === 0 ? detectionsFor(pose, detector) : null
  const swing = updateSwingTracker(run.tracker, { time: run.time, body, detections, energy })
  if (swing) run.swings.push(swing)
  const heard = [run.tracker.cue, swing].filter((said) => said !== null)
  run.heard.push(...heard.map((said) => ({ at: run.time, heard: said })))
  const shown = nextCaption(run.shown, run.tracker, run.time)
  if (shown !== run.shown) run.captions.push(shown.caption)
  run.shown = shown
}

function hold(run: Run, pose: Pose | null, frames: number, options: StepOptions = {}) {
  Array.from({ length: frames }, () => step(run, pose, options))
}

/** Holds a bottle still at the load until the detector has seen it enough to lock it, then stands loaded. */
function lockAndLoad(run: Run, offset = LOAD, pose: Partial<Pose> = {}) {
  hold(run, { ...pose, offset }, 12, { detector: 'bottle' })
  hold(run, { ...pose, offset }, 10)
}

/** Frames enough to span `ms`. */
function framesFor(ms: number) {
  return Math.ceil(ms / FRAME_MS)
}

/** Holds the empty hands still at the load, the detector finding nothing, until the tracker plays free mode. */
function goFree(run: Run) {
  hold(run, { offset: LOAD }, framesFor(HELD_OBJECT_RULES.handsOnlyAfterMs) + 4, { detector: 'nothing' })
}

function minimumJerk(fraction: number) {
  return fraction ** 3 * (10 - 15 * fraction + 6 * fraction ** 2)
}

/** The share of a minimum-jerk sweep from `from` to `to` at which it crosses the midline. */
function crossingFraction(from: number, to: number) {
  const target = -from / (to - from)
  let low = 0
  let high = 1
  for (let round = 0; round < 50; round++) {
    const middle = (low + high) / 2
    const short = minimumJerk(middle) < target
    low = short ? middle : low
    high = short ? high : middle
  }
  return low
}

/**
 * A human-like (minimum-jerk) sweep from `from` to `to` SW over `seconds`, begun `phaseMs` before the latest frame, in
 * the pose `poseAt` gives each frame of it, and the true moment the grip crossed the midline.
 */
function sweepAcross(
  run: Run,
  from: number,
  to: number,
  seconds: number,
  phaseMs = 0,
  poseAt: (frame: number) => Partial<Pose> = () => ({}),
) {
  const startedAt = run.time - phaseMs
  const durationMs = seconds * 1000
  const frames = Math.ceil((durationMs + phaseMs) / FRAME_MS) + 1
  Array.from({ length: frames }, (_, frame) => {
    const fraction = Math.min(1, (run.time + FRAME_MS - startedAt) / durationMs)
    step(run, { ...poseAt(frame), offset: from + (to - from) * minimumJerk(fraction) }, { energy: LOUD })
  })
  return startedAt + crossingFraction(from, to) * durationMs
}

/** The grip moving in a straight line from `from` to `to` SW over `frames` frames. */
function moveStraight(run: Run, from: number, to: number, frames: number, options: StepOptions & Partial<Pose> = {}) {
  const { energy = LOUD, ...pose } = options
  Array.from({ length: frames }, (_, index) =>
    step(run, { ...pose, offset: from + ((to - from) * (index + 1)) / frames }, { energy }),
  )
}

describe('the camera swing tracker', () => {
  it('fires once for a load and a sweep across the body, at the moment the grip crossed the midline', () => {
    ;[0, 11, 22].forEach((phaseMs) => {
      const run = camera()
      lockAndLoad(run)
      expect(run.tracker.state).toBe('loaded')
      const crossedAt = sweepAcross(run, LOAD, 0.7, 0.2, phaseMs)
      expect(run.swings).toHaveLength(1)
      expect(Math.abs(run.swings[0].contactAtMs - crossedAt)).toBeLessThan(5)
      expect(run.swings[0].speed).toBeGreaterThan(SWING_RULES.swingSpeed)
      expect(run.swings[0].batHeight).toBeCloseTo(STRIKE_ZONE.center, 6)
      hold(run, { offset: 0.7 }, 30)
      expect(run.swings).toHaveLength(1)
    })
  })

  it('measures the bat higher for a grip that crosses higher against the visitor’s shoulders', () => {
    const run = camera()
    lockAndLoad(run)
    sweepAcross(run, LOAD, 0.7, 0.2, 0, () => ({ gripY: LEVEL_Y - 0.5 * SHOULDER_WIDTH_Y }))
    expect(run.swings[0].batHeight).toBeCloseTo(STRIKE_ZONE.center + 0.5 * CONTACT_HEIGHT.metersPerShoulderWidth, 6)
  })

  it('fires nothing before an object is locked, from hands not loaded behind the body, nor for a dim sweep', () => {
    const unlocked = camera()
    hold(unlocked, { offset: LOAD }, 22)
    sweepAcross(unlocked, LOAD, 0.7, 0.2)
    expect(unlocked.tracker.state).toBe('searching')
    expect(unlocked.swings).toEqual([])
    const fromTheChest = camera()
    lockAndLoad(fromTheChest, -0.15)
    expect(fromTheChest.tracker.state).toBe('locked')
    sweepAcross(fromTheChest, -0.15, 0.7, 0.15)
    expect(fromTheChest.swings).toEqual([])
    const dim = camera()
    lockAndLoad(dim)
    moveStraight(dim, LOAD, 0.2, 3, { energy: DIM })
    expect(dim.swings).toEqual([])
    const lit = camera()
    lockAndLoad(lit)
    moveStraight(lit, LOAD, 0.2, 3)
    expect(lit.swings).toHaveLength(1)
  })

  it('fires nothing for a slow wave across the body, a walk across the picture, or a flick of the wrists in place', () => {
    // Across the body at 3 SW/s, crossing well within time.
    const slow = camera()
    lockAndLoad(slow)
    moveStraight(slow, LOAD, 0.7, 13)
    hold(slow, { offset: 0.7 }, 10)
    expect(slow.swings).toEqual([])

    // The whole visitor goes by at 8 SW/s, hands and head together.
    const walking = camera()
    lockAndLoad(walking)
    Array.from({ length: 6 }, (_, index) =>
      step(walking, { offset: LOAD, centre: 0.5 + (index + 1) * 0.04 }, { energy: LOUD }),
    )
    hold(walking, { offset: LOAD, centre: 0.74 }, 20)
    expect(walking.swings).toEqual([])

    const flick = camera()
    lockAndLoad(flick)
    moveStraight(flick, LOAD, -0.3, 2)
    moveStraight(flick, -0.3, LOAD, 2)
    hold(flick, { offset: LOAD }, 20)
    expect(flick.swings).toEqual([])
    // Held at the chest, just loaded, and flicked over the midline and back.
    const shortFlick = camera()
    lockAndLoad(shortFlick, -0.3)
    moveStraight(shortFlick, -0.3, 0.3, 2)
    moveStraight(shortFlick, 0.3, -0.3, 2)
    hold(shortFlick, { offset: -0.3 }, 20)
    expect(shortFlick.swings).toEqual([])
  })

  it('fires once per load: neither the bat coming back nor a sweep before the next load swings again', () => {
    const run = camera()
    lockAndLoad(run)
    sweepAcross(run, LOAD, 0.7, 0.2)
    hold(run, { offset: 0.7 }, 20)
    // Back toward the load, fast, but only to the chest, then across again.
    sweepAcross(run, 0.7, -0.1, 0.2)
    sweepAcross(run, -0.1, 0.7, 0.2)
    hold(run, { offset: 0.7 }, 20)
    expect(run.swings).toHaveLength(1)
    sweepAcross(run, 0.7, LOAD, 0.25)
    hold(run, { offset: LOAD }, 10)
    sweepAcross(run, LOAD, 0.7, 0.2)
    expect(run.swings).toHaveLength(2)
  })

  it('counts a fast swing whose wrists blur out just before the midline, its bat height unknown, but not a slow one', () => {
    const blurred = camera()
    lockAndLoad(blurred)
    const startedAt = blurred.time
    // 0.21 SW a frame from the load, so the grip would have crossed 2.86 frames in.
    moveStraight(blurred, LOAD, LOAD + 0.42, 2)
    hold(blurred, { offset: 0, wristsSeen: false }, 3, { energy: LOUD })
    expect(blurred.swings).toHaveLength(1)
    expect(Math.abs(blurred.swings[0].contactAtMs - (startedAt + (0.6 / 0.21) * FRAME_MS))).toBeLessThan(FRAME_MS)
    expect(blurred.swings[0].batHeight).toBeNull()

    // A fast first step, then a creep to just short of the midline when the wrists go.
    const slowing = camera()
    lockAndLoad(slowing)
    moveStraight(slowing, LOAD, -0.25, 1)
    moveStraight(slowing, -0.25, -0.05, 8)
    hold(slowing, { offset: 0, wristsSeen: false }, 4, { energy: LOUD })
    expect(slowing.swings).toEqual([])
  })

  it('swings in free mode on the pose and motion alone, and after a tap on the thing in the hands', () => {
    const free = camera()
    goFree(free)
    expect(free.tracker.lock?.kind).toBe('free')
    sweepAcross(free, LOAD, 0.7, 0.2)
    expect(free.swings).toHaveLength(1)

    const byHand = camera()
    hold(byHand, { offset: LOAD }, 4)
    // The tap lands on the hands, in the raw image's units (x scaled by the aspect).
    lockByHand(byHand.tracker, { x: (0.5 + LOAD * SHOULDER_WIDTH_X) * ASPECT, y: LEVEL_Y })
    expect(byHand.tracker.lock?.kind).toBe('manual')
    hold(byHand, { offset: LOAD }, 10)
    sweepAcross(byHand, LOAD, 0.7, 0.2)
    expect(byHand.swings).toHaveLength(1)
  })

  it('times a one-handed swing against the frontal body, through a turned torso and a wrist hidden at the crossing', () => {
    const run = camera()
    lockAndLoad(run, LOAD, { oneHanded: true })
    expect(run.tracker.hand).toBe('right')
    // Turned to load for longer than the visitor stood square, then the holding wrist hides behind the body mid-sweep.
    hold(run, { offset: LOAD, oneHanded: true, torso: TURNED }, 40)
    const crossedAt = sweepAcross(run, LOAD, 0.7, 0.2, 0, (frame) => ({
      oneHanded: true,
      torso: TURNED,
      gripSeen: frame < 1 || frame > 3,
    }))
    expect(run.swings).toHaveLength(1)
    expect(Math.abs(run.swings[0].contactAtMs - crossedAt)).toBeLessThan(5)
    expect(run.swings[0].batHeight).toBeCloseTo(STRIKE_ZONE.center, 6)
  })

  it('captions each lock, swing, and failed sweep, and never calls a swing’s finish the wrong side', () => {
    // Locked, loaded, then swept across too slowly: the hint shows even though the load was only just shown.
    const slow = camera()
    lockAndLoad(slow)
    moveStraight(slow, LOAD, 0.7, 13)
    hold(slow, { offset: 0.7 }, 30)
    expect(slow.swings).toEqual([])
    expect(slow.captions).toContain('locked')
    expect(slow.captions.indexOf('faster')).toBeGreaterThan(slow.captions.indexOf('locked'))
    expect(slow.captions).not.toContain('otherSide')

    // A swing, then its finish held: pull back again, not the wrong side.
    const swung = camera()
    lockAndLoad(swung)
    sweepAcross(swung, LOAD, 0.9, 0.2)
    hold(swung, { offset: 0.9 }, 60)
    expect(swung.swings).toHaveLength(1)
    expect(swung.captions.slice(-2)).toEqual(['swing', 'pullBack'])
    // Back by the body, then loaded on the far side: that is the wrong side.
    hold(swung, { offset: 0 }, 30)
    hold(swung, { offset: 0.6 }, 30)
    expect(swung.captions.at(-1)).toBe('otherSide')
  })

  it('holds the caption against a state that keeps changing, but says what just happened at once', () => {
    const tracker = createSwingTracker('right')
    tracker.reason = 'pullBack'
    const pullBack = nextCaption(null, tracker, 0)
    tracker.reason = 'loaded'
    expect(nextCaption(pullBack, tracker, CAPTION_HOLD_MS - 1)).toBe(pullBack)
    expect(nextCaption(pullBack, tracker, CAPTION_HOLD_MS).caption).toBe('loaded')
    notify(tracker, 'swing')
    const swing = nextCaption(pullBack, tracker, 100)
    expect(swing.caption).toBe('swing')
    expect(nextCaption(swing, tracker, 100 + CAPTION_HOLD_MS).caption).toBe('loaded')
  })

  it('plays free mode by itself once the hands have shown a while with nothing by them, but not while hands move', () => {
    const { handsOnlyAfterMs } = HELD_OBJECT_RULES
    // Hands in view while the detector rests (this computer being timed): the search's time runs, but nothing ends it
    // until the detector has looked; its first run that finds nothing by the still hands plays free.
    const timed = camera()
    hold(timed, { offset: LOAD }, framesFor(handsOnlyAfterMs * 2))
    expect(timed.tracker.state).toBe('searching')
    hold(timed, { offset: LOAD }, 3, { detector: 'nothing' })
    expect(timed.tracker.lock?.kind).toBe('free')
    // Told all along that the camera is looking (which says the hands will do), never that it is locking, then that
    // the hands will do.
    expect(timed.captions).toEqual(['looking', 'free'])
    // Hands that show only once the detector runs: searching still just short of the time, free just after it.
    const run = camera()
    hold(run, { offset: LOAD }, framesFor(handsOnlyAfterMs) - 4, { detector: 'nothing' })
    expect(run.tracker.state).toBe('searching')
    hold(run, { offset: LOAD }, 8, { detector: 'nothing' })
    expect(run.tracker.lock?.kind).toBe('free')
    // Hands that keep moving wait for a still moment, and are asked for one once the time is up.
    const restless = camera()
    const fidget = (detector: StepOptions['detector']) => (_: unknown, index: number) =>
      step(restless, { offset: LOAD + (index % 2) * 0.3 }, { detector })
    Array.from({ length: framesFor(handsOnlyAfterMs * 2) }, fidget('nothing'))
    expect(restless.tracker.state).toBe('searching')
    expect(restless.captions).toEqual(['looking', 'holdStill'])
    // An object that shows up in hands still moving locks once they stop, rather than free mode at their first still
    // moment; so does one that shows up just before the time is up.
    Array.from({ length: 6 }, fidget('bottle'))
    hold(restless, { offset: LOAD }, 12, { detector: 'bottle' })
    expect(restless.tracker.lock?.kind).toBe('detected')
    const late = camera()
    hold(late, { offset: LOAD }, framesFor(handsOnlyAfterMs) - 3, { detector: 'nothing' })
    hold(late, { offset: LOAD }, 9, { detector: 'bottle' })
    expect(late.tracker.lock?.kind).toBe('detected')
  })

  it('reads arms hanging apart in free mode as no load at all, rather than a load on the side of either wrist', () => {
    const relaxed = camera()
    const hanging = { offset: 0, armsApart: 1.4 }
    hold(relaxed, hanging, framesFor(HELD_OBJECT_RULES.handsOnlyAfterMs) + 4, { detector: 'nothing' })
    hold(relaxed, hanging, framesFor(CAPTION_HOLD_MS) + 1)
    expect([relaxed.tracker.lock?.kind, relaxed.tracker.state, relaxed.captions.at(-1)]).toEqual([
      'free',
      'locked',
      'pullBack',
    ])
  })

  it('takes a real object found later in place of free mode, and hands a lost one back to it at once, on every step', () => {
    ;[true, false].forEach((settingUp) => {
      const run = camera()
      run.tracker.settingUp = settingUp
      goFree(run)
      expect([run.tracker.lock?.kind, run.tracker.state]).toEqual(['free', 'loaded'])
      hold(run, { offset: LOAD }, 12, { detector: 'bottle' })
      expect(run.tracker.lock).toMatchObject({ kind: 'detected', label: 'bottle' })
      expect(run.tracker.state).toBe('loaded')
      // Lost while the visitor holds still between pitches: their hands take over on the very run that lets it go,
      // with no search for a new one, so the load (and a stance held with it) never breaks, and the caption says so.
      const seen = new Set<string>()
      const captionsBefore = run.captions.length
      Array.from({ length: framesFor(HELD_OBJECT_RULES.lostAfterMs) + 12 }, () => {
        step(run, { offset: LOAD }, { detector: 'nothing' })
        seen.add(`${run.tracker.lock?.kind} ${run.tracker.state}`)
      })
      expect([...seen]).toEqual(['detected loaded', 'free loaded'])
      expect(run.captions.slice(captionsBefore)).toContain('lost')
      // So the next pitch, which the detector rests through, is swung at.
      sweepAcross(run, LOAD, 0.7, 0.2)
      expect(run.swings).toHaveLength(1)
    })
  })

  it('marks what the detector finds by the hands with its lock’s progress, then the locked object solid', () => {
    const run = camera()
    hold(run, { offset: LOAD }, 3, { detector: 'bottle' })
    const found = objectMark(run.tracker, run.time)
    expect(found).toMatchObject({ label: 'bottle', locked: false, progress: 1 / HELD_OBJECT_RULES.lockHits })
    // Between detector runs the box goes along with the hands.
    step(run, { offset: LOAD + 0.1 })
    const foundX = found?.box.x ?? Number.NaN
    expect(objectMark(run.tracker, run.time)?.box.x).toBeCloseTo(foundX + 0.1 * SHOULDER_WIDTH_X * ASPECT, 9)
    hold(run, { offset: LOAD }, 9, { detector: 'bottle' })
    expect(objectMark(run.tracker, run.time)).toMatchObject({ label: 'bottle', locked: true })
    // Once no detector run has seen it lately (the detector resting through a pitch), it is no longer marked.
    const resting = camera()
    hold(resting, { offset: LOAD }, 3, { detector: 'bottle' })
    hold(resting, { offset: LOAD }, framesFor(HELD_OBJECT_RULES.candidateFreshMs) + 1)
    expect(objectMark(resting.tracker, resting.time)).toBeNull()
    // On the setup step free mode marks nothing until something shows by the hands, and only while runs keep seeing it.
    const free = camera()
    free.tracker.settingUp = true
    goFree(free)
    expect(objectMark(free.tracker, free.time)).toBeNull()
    hold(free, { offset: LOAD }, 3, { detector: 'bottle' })
    expect(objectMark(free.tracker, free.time)).toMatchObject({ label: 'bottle', locked: false })
    hold(free, { offset: LOAD }, framesFor(HELD_OBJECT_RULES.candidateFreshMs) + 1)
    expect(objectMark(free.tracker, free.time)).toBeNull()
    // Off the setup step, only once it locks: a glimpse by empty hands between pitches would only flash.
    const playing = camera()
    goFree(playing)
    hold(playing, { offset: LOAD }, 3, { detector: 'bottle' })
    expect(playing.tracker.candidate).toMatchObject({ label: 'bottle' })
    expect(objectMark(playing.tracker, playing.time)).toBeNull()
  })

  it('cues a swing as a fast sweep closes on the midline, reports it on the crossing frame, and cues a check', () => {
    // From deep behind the body, the grip closes fast frames before it crosses: the swing is cued then, crossing about
    // when it does (a little late, the grip still speeding up), and reported on the frame it crossed.
    const swung = camera()
    lockAndLoad(swung, -1)
    const crossedAt = sweepAcross(swung, -1, 0.7, 0.2)
    const [started, reported, ...after] = swung.heard
    expect(started.heard).toMatchObject({ kind: 'started' })
    expect(Math.abs((started.heard as { crossingAtMs: number }).crossingAtMs - crossedAt)).toBeLessThan(35)
    expect(reported.heard).toBe(swung.swings[0])
    expect(reported.at - started.at).toBeGreaterThan(FRAME_MS)
    expect(reported.at - crossedAt).toBeLessThan(FRAME_MS)
    expect(after).toEqual([])
    // Stopped short of the midline and brought back to the load: checked as it gets there.
    const checked = camera()
    lockAndLoad(checked, -1)
    moveStraight(checked, -1, -0.2, 2)
    moveStraight(checked, -0.2, -1, 3)
    hold(checked, { offset: -1 }, 10)
    expect(checked.swings).toEqual([])
    expect(checked.heard.map(({ heard }) => (heard as SwingCue).kind)).toEqual(['started', 'checked'])
    // Wobble at the load, a slow wave across the body, and the bat coming back from the far side cue nothing.
    const quiet = camera()
    lockAndLoad(quiet)
    Array.from({ length: 20 }, (_, index) => step(quiet, { offset: LOAD + (index % 2) * 0.12 }, { energy: LOUD }))
    moveStraight(quiet, LOAD, 0.7, 13)
    hold(quiet, { offset: 0.7 }, 20)
    sweepAcross(quiet, 0.7, LOAD, 0.2)
    expect(quiet.heard).toEqual([])
  })

  it('cues a swing as slow as the webcam log’s slower real ones, but not the hands moving about', () => {
    // Straight across from deep behind the body at 6.5 SW/s: cued frames before it is reported.
    const swung = camera()
    lockAndLoad(swung, -1)
    moveStraight(swung, -1, 0.3, 6)
    const [started, reported] = swung.heard
    expect(started.heard).toMatchObject({ kind: 'started' })
    expect(reported.heard).toBe(swung.swings[0])
    expect(reported.at - started.at).toBeGreaterThan(FRAME_MS)
    // Toward the midline at 4.5 SW/s, as the log's sweeps that were no swing go, and back to the load: nothing begun.
    const fidgeting = camera()
    lockAndLoad(fidgeting, -1)
    moveStraight(fidgeting, -1, -0.4, 4)
    moveStraight(fidgeting, -0.4, -1, 4)
    hold(fidgeting, { offset: -1 }, 10)
    expect(fidgeting.heard).toEqual([])
    // Stepped out of the load, then dropped fast, as hands relaxing between pitches go: fast, but not toward the midline.
    const relaxing = camera()
    lockAndLoad(relaxing, -1)
    step(relaxing, { offset: -0.85 })
    ;[0.5, 1].forEach((drop) => step(relaxing, { offset: -0.85, gripY: LEVEL_Y + drop * SHOULDER_WIDTH_Y }))
    hold(relaxing, { offset: -0.85, gripY: LEVEL_Y + SHOULDER_WIDTH_Y }, 20)
    expect(relaxing.heard).toEqual([])
  })

  it('neither cues nor coaches a wrist blinking out of a still two-hand grip, but cues a swing seen on one wrist', () => {
    // Hands-only mode follows the middle of both wrists. Held still apart behind the body, the deeper wrist blinks out
    // for a frame, so the grip jumps to the other wrist, near the midline or past it, and back: the batter starts no
    // swing, and the caption tells the visitor nothing about one.
    const swingWords: TrackerReason[] = Object.values(SWEEP_FAILURE_REASONS)
    ;[
      { offset: -0.8, armsApart: 1.2 },
      { offset: -0.6, armsApart: 1.6 },
    ].forEach((apart) => {
      const blinking = camera()
      goFree(blinking)
      hold(blinking, apart, 10)
      Array.from({ length: 3 }, () => {
        step(blinking, { ...apart, gripSeen: false })
        hold(blinking, apart, 10)
      })
      expect(blinking.heard).toEqual([])
      expect(blinking.captions.filter((caption) => swingWords.includes(caption))).toEqual([])
    })
    // A wrist hidden from before the swing on: its frames share the one wrist, and the swing is cued as usual.
    const oneWrist = camera()
    goFree(oneWrist)
    hold(oneWrist, { offset: -1, gripSeen: false }, 10)
    sweepAcross(oneWrist, -1, 0.7, 0.2, 0, () => ({ gripSeen: false }))
    expect(oneWrist.heard.map(({ heard }) => heard)).toEqual([
      expect.objectContaining({ kind: 'started' }),
      oneWrist.swings[0],
    ])
  })

  it('loads a left-handed batter on the picture’s right and takes only their swing toward the left', () => {
    const left = camera('left')
    lockAndLoad(left, -LOAD)
    sweepAcross(left, -LOAD, -0.7, 0.2)
    expect(left.swings).toHaveLength(1)
    const wrongWay = camera('left')
    lockAndLoad(wrongWay)
    sweepAcross(wrongWay, LOAD, 0.7, 0.2)
    expect(wrongWay.swings).toEqual([])
  })
})
