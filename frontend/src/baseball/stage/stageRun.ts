import type { Vec3 } from '../../data/models'
import { lerp } from '../../motionMath'
import {
  advanceDerby,
  createDerby,
  LATE_SWING_MARGIN_MS,
  latestContactMs,
  RESULT_HOLD_MS,
  type Derby,
  type DerbyEvent,
  type DerbySwing,
  type DerbyUpdate,
  swingDerby,
} from '../game/derby'
import type { DerbyInputLog, SwingEvent } from '../game/derbyScore'
import { BATTER_REACH, type BattingSide } from '../game/field'
import { type BallFlight, createFlight, launchForLanding, predictLanding, sprayPoint, stepFlight } from '../game/flight'
import { createGameClock, gameTime, type GameClock, holdClock, setClockRate } from '../game/gameClock'
import type { Landing } from '../game/landing'
import { meetSeconds, type PitchPlan, type PitchTypeId, pitchPosition, secondsAtDepth } from '../game/pitch'
import type { RunPlan } from '../game/runPlan'
import { begunSwingState, CONTACT_DELAY_MS, lastStretchMs } from './actors/swingMotion'
import { type BallSpin, type BallView, TRAIL_LENGTH } from './ballMeshes'
import { battingShot, type CameraShot, chaseShot, isShowcaseHomeRun, wideShot } from './cameraShots'
import { MITT_DEPTH } from './stageLayout'

// A run as the stage plays it: the derby (game/derby.ts) on its game clock, plus what only the stage shows. The ball is
// in the pitcher's hand until the derby releases it, then pitched on the derby's own times. A pitch waits at the back
// of the batter's reach while a swing that touches it could still be reported (a camera swing comes up to the derby's
// late margin after it), so the mitt never catches a ball the bat then hits; a ball in play leaves the bat where and
// when the bat met it and flies to the landing the judge already decided. The batter's swing is the stage's too
// (ShownSwing): it begins when the camera sees the visitor begin one, and a judged swing gets its last stretch to the
// ball, a frame or two from near the slot for a swing begun, the whole way from the windup for one the camera saw no
// start of. The stage changes the clock's pace (stepping it back when a swing that hit the ball came after that
// stretch's start, so the bat swings into it; a hit-stop at contact; slow motion at a showcase home run's peak; a pause
// while the page is hidden, or between pitches while the visitor is away) but never an outcome. Every function here
// mutates the run it is given; the director keeps it in a ref and reads it each frame.

/**
 * A run for the stage to play: its plan, how the visitor plays it (batting side, practice), and whether it is the
 * practice before a run, which keeps its own pace and late limit and its own judging (createDerby).
 */
export type StageRunSetup = { plan: RunPlan; log: Omit<DerbyInputLog, 'swings'>; practice?: boolean }

/** A swing as the camera reports it, on the real clock: performance.now() ms, as the frames it was seen in. */
export type RealTimeSwing = Omit<DerbySwing, 'contactAtMs' | 'startedAtMs'> & {
  contactAtRealMs: number
  startedAtRealMs: number
}

/**
 * The camera's cue of a swing on the real clock, for the batter's look only: the visitor began one whose grip should
 * cross the midline at `crossingAtRealMs` (performance.now() ms, as the frames it was seen in), or ended it with
 * none.
 */
export type RealTimeSwingCue = { kind: 'started'; crossingAtRealMs: number } | { kind: 'checked' }

/**
 * The derby's events, and the moments only the stage knows: the batter starting the swing the camera saw begin, the
 * bat meeting the ball, the camera starting to chase it, it coming down, the catch.
 */
export type StageEvent =
  | DerbyEvent
  | { type: 'swing'; pitchIndex: number }
  | { type: 'contact'; pitchIndex: number }
  | { type: 'chase'; pitchIndex: number }
  | { type: 'landed'; pitchIndex: number }
  | { type: 'caught'; pitchIndex: number }

type ResultEvent = Extract<DerbyEvent, { type: 'result' }>

export const STAGE_TIMING = {
  hitStopMs: 90,
  /** Batted balls fly at least this much faster than real time, and a high one faster still (flightRateFor). */
  minimumFlightRate: 1.5,
  /** A ball in play comes down at least this long (game ms) before its result ends, so the chase sees it land. */
  landingLeadMs: 500,
  /** The batting shot watches the ball leave the bat this long (game ms) before the camera chases it. */
  launchHoldMs: 450,
  apexSlowMotion: { rate: 0.35, realMs: 800 },
  /** Seconds between the pitch's trail points, each where the ball was that much earlier on its curve. */
  pitchTrailSeconds: 0.022,
  /** Seconds of flight between a batted ball's trail points, so the trail is as long at any frame rate. */
  flightTrailSeconds: 0.05,
}

/** How each pitch type spins on its way, so the visitor can tell them apart before the result names them. */
export const PITCH_SPIN = {
  fastball: { axis: { x: -1, y: 0, z: 0 }, radiansPerSecond: 48 },
  changeup: { axis: { x: -1, y: 0.5, z: 0 }, radiansPerSecond: 24 },
  curve: { axis: { x: 1, y: 0, z: 0.45 }, radiansPerSecond: 36 },
} satisfies Record<PitchTypeId, BallSpin>

export const BATTED_SPIN_RADIANS_PER_SECOND = 30

/**
 * A pitch on its way. It waits at the back of the batter's reach until `holdSeconds` after its release, while a swing
 * that touches it could still be reported, then goes on into the mitt.
 */
export type PitchOnStage = { index: number; plan: PitchPlan; releasedMs: number; holdSeconds: number; caught: boolean }

/** Where a ball in play was `seconds` into its flight. */
export type TrailSample = { seconds: number; position: Vec3 }

/**
 * A ball in play: where and when (game ms) the bat met it, how much faster than real time it flies, its flight once
 * the bat has met it, whether the camera has started chasing it, and its recent path (newest first).
 */
export type BattedBall = {
  pitchIndex: number
  landing: Landing
  meetMs: number
  start: Vec3
  velocity: Vec3
  flightRate: number
  flight: BallFlight | null
  steppedToMs: number
  showcase: boolean
  chased: boolean
  peaked: boolean
  trail: TrailSample[]
}

/**
 * The swing the batter shows for pitch `pitchIndex` (game ms), which only the stage knows: `begun` when the camera saw
 * the visitor begin it, to be nearly at the slot by `readyMs` (swingMotion.ts BEGUN_SWING); `checkedMs` when the
 * visitor ended it without a swing, or the pitch was judged without one; `judged` when the stage took the derby's swing
 * (before any step back of the clock), when its last stretch to the ball starts, and when its bat meets the ball. Each
 * change makes a new one, so the batter sees it once.
 */
export type ShownSwing = {
  pitchIndex: number
  begun: { startedMs: number; readyMs: number } | null
  checkedMs: number | null
  judged: { takenMs: number; throughMs: number; contactMs: number } | null
}

/**
 * `awaitingMs` is the game ms the clock steps back to once the batter has aimed a swing judged with a ball in play,
 * while the clock stands still for it (swingStageRun); null otherwise.
 */
export type StageRun = {
  clock: GameClock
  derby: Derby
  pitch: PitchOnStage | null
  batted: BattedBall | null
  shown: ShownSwing | null
  slowMotionEndsRealMs: number | null
  awaitingMs: number | null
}

export function createStageRun({ plan, log, practice }: StageRunSetup, realMs: number): StageRun {
  const clock = createGameClock(realMs)
  return {
    clock,
    derby: createDerby(plan, log, gameTime(clock, realMs), practice),
    pitch: null,
    batted: null,
    shown: null,
    slowMotionEndsRealMs: null,
    awaitingMs: null,
  }
}

/** A real-time swing on the run's game clock; convert it before the clock next changes pace. */
export function toDerbySwing(clock: GameClock, swing: RealTimeSwing): DerbySwing {
  const { contactAtRealMs, startedAtRealMs, ...measured } = swing
  return { ...measured, contactAtMs: gameTime(clock, contactAtRealMs), startedAtMs: gameTime(clock, startedAtRealMs) }
}

/**
 * A camera swing handed in at real moment `realMs`. A hit handed in too late for the bat's last stretch to the ball
 * (shownAfterResult) to end at the meeting steps the clock back to that stretch's start, so the bat swings into the
 * ball where the stage sends it off, the ball going back along its path to meet it: about half as far for a swing the
 * camera saw begin. When `waitForBatter`, the clock first stands still, the ball waiting at the back of the reach and
 * the bat about where the camera's swing left it, until the batter has aimed the swing (resumeStageRun).
 */
export function swingStageRun(run: StageRun, swing: RealTimeSwing, realMs: number, waitForBatter = false) {
  const update = swingDerby(run.derby, toDerbySwing(run.clock, swing))
  const events = takeDerbyUpdate(run, update, gameTime(run.clock, realMs))
  const hit = events.some((event) => event.type === 'result' && event.swing !== null) && run.batted
  const judged = hit ? run.shown?.judged : null
  if (!judged) return events
  run.clock = waitForBatter ? setClockRate(run.clock, realMs, 0) : holdClock(run.clock, realMs, 0, judged.throughMs)
  run.awaitingMs = waitForBatter ? judged.throughMs : null
  return events
}

/** Once the batter has aimed a swing the stage waits for, steps the clock back to its last stretch and runs it on. */
export function resumeStageRun(run: StageRun, realMs: number) {
  if (run.awaitingMs === null) return
  run.clock = setClockRate(holdClock(run.clock, realMs, 0, run.awaitingMs), realMs, 1)
  run.awaitingMs = null
}

/**
 * A cue of the visitor's swing taken at real moment `realMs`, for what the batter shows of the pitch on its way. A
 * start begins the batter's swing, nearly at the slot when the camera expects the grip to cross the midline (`readyMs`,
 * swingMotion.ts BEGUN_SWING), mapped to game time as the judge maps a swing's contact (less the calibration's offset),
 * and no sooner than CONTACT_DELAY_MS from now; a swing already shown for the pitch takes no other, unless it was
 * checked, and says so with a `swing` event. A check stops one not judged yet. Between pitches, and once a pitch is
 * judged, a cue changes nothing, and none reaches the derby.
 */
export function cueStageSwing(run: StageRun, cue: RealTimeSwingCue, realMs: number): StageEvent[] {
  const { pitch, derby } = run
  if (!pitch || derby.phase !== 'pitch') return []
  const nowMs = gameTime(run.clock, realMs)
  const shown = run.shown?.pitchIndex === pitch.index ? run.shown : null
  const swinging = shown !== null && shown.checkedMs === null
  if (cue.kind === 'checked') checkShownSwing(run, swinging ? shown : null, nowMs)
  if (cue.kind === 'checked' || swinging) return []
  const crossingMs = gameTime(run.clock, cue.crossingAtRealMs) - derby.calibration.offsetMs
  const begun = { startedMs: nowMs, readyMs: Math.max(nowMs + CONTACT_DELAY_MS, crossingMs) }
  run.shown = { pitchIndex: pitch.index, begun, checkedMs: null, judged: null }
  return [{ type: 'swing', pitchIndex: pitch.index }]
}

/** Checks `shown`, a swing shown and not judged, at game time `nowMs`; nothing without one. */
export function checkShownSwing(run: StageRun, shown: ShownSwing | null, nowMs: number) {
  if (shown) run.shown = { ...shown, checkedMs: nowMs }
}

/**
 * Everything due by `realMs`: the derby's phase changes, then the catch, the contact, the chase (on the clock as the
 * contact's hit-stop left it), and the batted ball's flight. Nothing is while the stage waits for the batter, its clock
 * still past the contact it is about to step back to.
 */
export function advanceStageRun(run: StageRun, realMs: number, reducedMotion: boolean): StageEvent[] {
  if (run.awaitingMs !== null) return []
  endSlowMotion(run, realMs)
  const nowMs = gameTime(run.clock, realMs)
  const derbyEvents = takeDerbyUpdate(run, advanceDerby(run.derby, nowMs), nowMs)
  const cues = [
    ...catchCue(run, nowMs),
    ...contactCue(run, nowMs, realMs),
    ...chaseCue(run, gameTime(run.clock, realMs)),
  ]
  return [...derbyEvents, ...cues, ...flyBall(run, realMs, reducedMotion)]
}

/**
 * Stops the game clock while the page is hidden (frames stop too, so no pitch goes by unseen) or while the page pauses
 * the run, which it does only between pitches (flow/derbyFlow.ts pausedForAway), and starts it again after.
 */
export function setStageRunPaused(run: StageRun, realMs: number, paused: boolean) {
  run.clock = setClockRate(run.clock, realMs, paused || run.awaitingMs !== null ? 0 : 1)
  run.slowMotionEndsRealMs = null
}

/** Takes the derby's update, which the stage got at game time `nowMs`. */
export function takeDerbyUpdate(run: StageRun, update: DerbyUpdate, nowMs: number): StageEvent[] {
  run.derby = update.derby
  update.events.forEach((event) => stageDerbyEvent(run, event, nowMs))
  return update.events
}

/**
 * A release puts the next pitch on its way, waiting as long as a swing that touches it could still be reported (in
 * practice, any swing the derby takes, as each is judged against a usual timing that includes it); a result, taken at
 * game time `nowMs`, sets up its batted ball, if any, and may end the pitch's wait.
 */
export function stageDerbyEvent(run: StageRun, event: DerbyEvent, nowMs: number) {
  if (event.type === 'release') {
    const holdSeconds = (latestContactMs(run.derby, event.pitch) + LATE_SWING_MARGIN_MS) / 1000
    run.pitch = { index: event.pitchIndex, plan: event.pitch, releasedMs: event.releasedMs, holdSeconds, caught: false }
    run.batted = null
    run.shown = null
    return
  }
  if (event.type !== 'result') return
  run.batted = battedBallFor(run, event)
  endHold(run, event, nowMs)
  run.shown = shownAfterResult(run, event, nowMs)
}

/**
 * The swing the batter shows once its pitch is judged, taken at game time `nowMs`. A judged swing's bat meets the ball
 * in play when the stage sends it off (swingStageRun steps the clock back to give it its last stretch), or for a miss
 * passes where it is aimed at the swing's judged contact, but never sooner than its last stretch after the stage took
 * it (lastStretchFor). A swing begun and not judged is checked.
 */
export function shownAfterResult(run: StageRun, event: ResultEvent, nowMs: number): ShownSwing | null {
  const shown = run.shown?.pitchIndex === event.pitchIndex ? run.shown : null
  const { pitch, batted } = run
  if (!event.swing || !pitch) return shown && { ...shown, checkedMs: shown.checkedMs ?? nowMs }
  const stretchMs = lastStretchFor(shown, nowMs)
  const judgedMs = pitch.releasedMs + judgedContactMs(run.derby, event.swing)
  const contactMs = batted ? batted.meetMs : Math.max(judgedMs, nowMs + stretchMs)
  const earlier = { begun: null, checkedMs: null, ...shown }
  const judged = { takenMs: nowMs, throughMs: contactMs - stretchMs, contactMs }
  return { ...earlier, pitchIndex: event.pitchIndex, judged }
}

/**
 * How long (game ms) the last stretch to the ball takes for the swing `shown` that the stage takes at `nowMs`: from
 * about where a swing the camera saw begin is drawn then and as fast (lastStretchMs), so one near the slot meets the
 * ball in about half the time, a frame or two; CONTACT_DELAY_MS for one checked or never seen to begin, from the
 * windup.
 */
export function lastStretchFor(shown: ShownSwing | null, nowMs: number) {
  const begun = shown?.checkedMs === null ? shown.begun : null
  if (!begun) return CONTACT_DELAY_MS
  const { seconds, rate } = begunSwingState(begun.startedMs, begun.readyMs, nowMs)
  return lastStretchMs(seconds, rate)
}

/**
 * When, after its pitch's release (ms), the judge has a swing's bat at the contact point: the moment the camera
 * reported less the visitor's calibrated offset (judging.ts timingErrorMs). The stage draws the bat there then, so a
 * PERFECT swing meets the ball at the contact point whichever way the calibration leans.
 */
export function judgedContactMs(derby: Derby, swing: SwingEvent) {
  return swing.contactMs - derby.calibration.offsetMs
}

/**
 * A judged swing ends the pitch's wait at the back of the reach: no later swing can touch the ball. The wait ends no
 * sooner than the swing's judged contact, when the bat gets there, nor than `nowMs` (game ms), when the stage takes the
 * result, so a pitch that a swing reported late missed goes on from where it is drawn.
 */
export function endHold(run: StageRun, event: ResultEvent, nowMs: number) {
  const { pitch } = run
  if (!pitch || !event.swing) return
  const reachBack = secondsAtDepth(pitch.plan, BATTER_REACH.back)
  const swingSeconds = judgedContactMs(run.derby, event.swing) / 1000
  const takenSeconds = (nowMs - pitch.releasedMs) / 1000
  pitch.holdSeconds = Math.min(pitch.holdSeconds, Math.max(reachBack, swingSeconds, takenSeconds))
}

/**
 * The batted ball for a result, or null when the ball was not hit. It leaves from where the bat met it at the swing's
 * judged contact: a swing reported a frame late still sends the ball from the bat, and a late one meets the ball
 * waiting at the back of the reach when the swing gets there.
 */
export function battedBallFor(run: StageRun, event: ResultEvent): BattedBall | null {
  const { pitch } = run
  const { pitchIndex, result, swing } = event
  if (!pitch || !swing || result.outcome === 'miss') return null
  const swingSeconds = judgedContactMs(run.derby, swing) / 1000
  const meet = meetSeconds(pitch.plan, swingSeconds)
  const start = pitchPosition(pitch.plan, meet)
  const velocity = launchForLanding(result, start)
  const meetMs = pitch.releasedMs + Math.max(meet, swingSeconds) * 1000
  // The derby's result runs from the swing's contact as the camera reported it (swingDerby).
  const resultEndsMs = pitch.releasedMs + swing.contactMs + RESULT_HOLD_MS[result.outcome]
  return {
    pitchIndex,
    landing: result,
    meetMs,
    start,
    velocity,
    flightRate: flightRateFor(predictLanding(start, velocity).hangSeconds, resultEndsMs - meetMs),
    flight: null,
    steppedToMs: 0,
    showcase: isShowcaseHomeRun(run.derby.results.slice(0, pitchIndex), result),
    chased: false,
    peaked: false,
    trail: [],
  }
}

/**
 * How much faster than real time a ball that hangs `hangSeconds` flies, so it comes down `landingLeadMs` before a
 * result that ends `untilResultEndsMs` after the bat met it.
 */
export function flightRateFor(hangSeconds: number, untilResultEndsMs: number) {
  const flyingMs = untilResultEndsMs - STAGE_TIMING.landingLeadMs
  return Math.max(STAGE_TIMING.minimumFlightRate, (hangSeconds * 1000) / flyingMs)
}

/** Seconds after release that a pitch not hit reaches the catcher's mitt on its curve. */
export function mittSeconds(plan: PitchPlan) {
  return secondsAtDepth(plan, MITT_DEPTH)
}

/**
 * Where on its curve (seconds after release) a pitch not hit is drawn `elapsed` seconds after release: on time to the
 * back of the batter's reach, held there until its hold ends, then on at its own pace into the mitt.
 */
export function drawnPitchSeconds(pitch: PitchOnStage, elapsed: number) {
  const reachBack = secondsAtDepth(pitch.plan, BATTER_REACH.back)
  const onward = Math.min(elapsed, reachBack) + Math.max(0, elapsed - Math.max(reachBack, pitch.holdSeconds))
  return Math.min(onward, mittSeconds(pitch.plan))
}

/**
 * The mitt catches a pitch not hit once the ball is in it and the derby has judged the pitch, so no swing still in
 * time, even one reported late, can follow the catch.
 */
export function catchCue(run: StageRun, nowMs: number): StageEvent[] {
  const { pitch, batted } = run
  if (!pitch || pitch.caught || batted?.pitchIndex === pitch.index || run.derby.results.length <= pitch.index) return []
  if (drawnPitchSeconds(pitch, (nowMs - pitch.releasedMs) / 1000) < mittSeconds(pitch.plan)) return []
  pitch.caught = true
  return [{ type: 'caught', pitchIndex: pitch.index }]
}

/**
 * The bat meets the ball: its flight starts, and the game clock stands still a moment at the meeting (hit-stop), stepped
 * back the part of a frame it ran past it, so the hit-stop shows the bat on the ball.
 */
export function contactCue(run: StageRun, nowMs: number, realMs: number): StageEvent[] {
  const { batted } = run
  if (!batted || batted.flight || nowMs < batted.meetMs) return []
  batted.flight = createFlight(batted.start, batted.velocity)
  batted.steppedToMs = batted.meetMs
  batted.trail = [{ seconds: 0, position: { ...batted.start } }]
  run.clock = holdClock(run.clock, realMs, STAGE_TIMING.hitStopMs, batted.meetMs)
  return [{ type: 'contact', pitchIndex: batted.pitchIndex }]
}

/**
 * Whether the camera chases the ball in play at game time `nowMs`: once the batting shot has watched it leave the bat a
 * moment, which the hit-stop holds back, until the next pitch.
 */
export function chasingBall(run: StageRun | null, nowMs: number) {
  const batted = run?.batted
  if (run?.derby.phase !== 'result' || !batted?.flight) return false
  return nowMs - batted.meetMs >= STAGE_TIMING.launchHoldMs
}

/** The camera starts chasing the ball in play, on the frame its shot does (directedShot). */
export function chaseCue(run: StageRun, nowMs: number): StageEvent[] {
  const { batted } = run
  if (!batted || batted.chased || !chasingBall(run, nowMs)) return []
  batted.chased = true
  return [{ type: 'chase', pitchIndex: batted.pitchIndex }]
}

/** Steps the batted ball to now and keeps its recent path; reports the step it comes down on. */
export function flyBall(run: StageRun, realMs: number, reducedMotion: boolean): StageEvent[] {
  const { batted } = run
  const flight = batted?.flight
  if (!batted || !flight || flight.landed) return []
  const nowMs = gameTime(run.clock, realMs)
  stepFlight(flight, ((nowMs - batted.steppedToMs) / 1000) * batted.flightRate)
  batted.steppedToMs = nowMs
  const newest = { seconds: flight.elapsed, position: { ...flight.position } }
  batted.trail = recentTrail([newest, ...batted.trail], flight.elapsed)
  slowAtPeak(run, batted, flight, realMs, reducedMotion)
  return flight.landed ? [{ type: 'landed', pitchIndex: batted.pitchIndex }] : []
}

/** The samples a trail can still draw from: those within its span, and the one just past it to draw up to its end. */
export function recentTrail(samples: TrailSample[], elapsed: number) {
  const span = TRAIL_LENGTH * STAGE_TIMING.flightTrailSeconds
  const tooOld = samples.findIndex((sample) => elapsed - sample.seconds > span)
  return tooOld < 0 ? samples : samples.slice(0, tooOld + 1)
}

/**
 * A showcase home run slows the clock as it passes its peak in the air, unless motion is reduced. Only while its result
 * plays: a ball stepped past its peak after a stalled frame must not slow the next pitch.
 */
export function slowAtPeak(
  run: StageRun,
  batted: BattedBall,
  flight: BallFlight,
  realMs: number,
  reducedMotion: boolean,
) {
  if (batted.peaked || flight.velocity.y > 0) return
  batted.peaked = true
  if (!batted.showcase || reducedMotion || flight.landed || run.derby.phase !== 'result') return
  const { rate, realMs: duration } = STAGE_TIMING.apexSlowMotion
  run.clock = setClockRate(run.clock, realMs, rate)
  run.slowMotionEndsRealMs = realMs + duration
}

export function endSlowMotion(run: StageRun, realMs: number) {
  const endsMs = run.slowMotionEndsRealMs
  if (endsMs === null || realMs < endsMs) return
  run.clock = setClockRate(run.clock, endsMs, 1)
  run.slowMotionEndsRealMs = null
}

const hidden: BallView = {
  visible: false,
  position: { x: 0, y: 0, z: 0 },
  spin: null,
  flying: false,
  trail: [],
  landing: null,
}

/**
 * The ball at game time `nowMs`. Until the derby releases it, it is the pitcher's, at `inHand` as he is posed (hidden
 * when he is not there to hold it).
 */
export function stageBallView(run: StageRun | null, nowMs: number, inHand: Vec3 | null): BallView {
  if (ballIsThePitchers(run)) return inHand ? { ...hidden, visible: true, position: inHand } : hidden
  if (!run || run.derby.phase === 'finished') return hidden
  if (run.batted?.flight) return flyingBallView(run.batted, run.batted.flight)
  if (!run.pitch) return hidden
  return pitchedBallView(run.pitch, run.derby.plan.schedule[run.pitch.index].type, nowMs)
}

/** Whether the ball is still the pitcher's: before a run, and before each release. */
export function ballIsThePitchers(run: StageRun | null) {
  return !run || run.derby.phase === 'ready' || run.derby.phase === 'windup'
}

export function mix(from: Vec3, to: Vec3, amount: number): Vec3 {
  return { x: lerp(from.x, to.x, amount), y: lerp(from.y, to.y, amount), z: lerp(from.z, to.z, amount) }
}

/** A pitch on its curve with its trail; in the mitt it stops spinning and leaves no trail. */
export function pitchedBallView(pitch: PitchOnStage, type: PitchTypeId, nowMs: number): BallView {
  const elapsed = (nowMs - pitch.releasedMs) / 1000
  const seconds = drawnPitchSeconds(pitch, elapsed)
  const inMitt = seconds >= mittSeconds(pitch.plan)
  return {
    visible: true,
    position: pitchPosition(pitch.plan, seconds),
    spin: inMitt ? null : PITCH_SPIN[type],
    flying: false,
    trail: inMitt ? [] : pitchTrail(pitch, elapsed),
    landing: null,
  }
}

/** Where the pitch was drawn a moment ago, a moment before that, and so on; taken from its path, never from old frames. */
export function pitchTrail(pitch: PitchOnStage, elapsed: number) {
  return Array.from({ length: TRAIL_LENGTH }, (_, index) => elapsed - (index + 1) * STAGE_TIMING.pitchTrailSeconds)
    .filter((earlier) => earlier >= 0)
    .map((earlier) => pitchPosition(pitch.plan, drawnPitchSeconds(pitch, earlier)))
}

/** A ball in play, backspinning along its path; a ball that stays in the park shows where it will come down. */
export function flyingBallView(batted: BattedBall, flight: BallFlight): BallView {
  const { landing } = batted
  const { velocity } = flight
  const showsLanding = landing.outcome !== 'homeRun' && !flight.landed
  return {
    visible: true,
    position: { ...flight.position },
    spin: flight.landed
      ? null
      : { axis: { x: -velocity.z, y: 0, z: velocity.x }, radiansPerSecond: BATTED_SPIN_RADIANS_PER_SECOND },
    flying: true,
    trail: flight.landed ? [] : flightTrail(batted.trail, flight.elapsed),
    landing: showsLanding ? sprayPoint(landing.spray, landing.distanceDecimetres / 10) : null,
  }
}

/** Where a ball in play was each trail step of flight ago, as far back as its samples reach. */
export function flightTrail(samples: readonly TrailSample[], elapsed: number) {
  return Array.from({ length: TRAIL_LENGTH }, (_, index) =>
    trailPoint(samples, elapsed - (index + 1) * STAGE_TIMING.flightTrailSeconds),
  ).filter((point): point is Vec3 => point !== null)
}

/** Where a ball in play was `seconds` into its flight, between the samples either side; null before the oldest. */
export function trailPoint(samples: readonly TrailSample[], seconds: number): Vec3 | null {
  const olderIndex = samples.findIndex((sample) => sample.seconds <= seconds)
  if (olderIndex < 1) return null
  const older = samples[olderIndex]
  const newer = samples[olderIndex - 1]
  return mix(older.position, newer.position, (seconds - older.seconds) / (newer.seconds - older.seconds))
}

/**
 * The shot for this frame: the batting shot, until a ball in play has been on its way a moment; then the chase, or
 * for a showcase home run past its peak, the landing camera. The next pitch cuts back to the batting shot.
 */
export function directedShot(
  run: StageRun | null,
  nowMs: number,
  aspect: number,
  side: BattingSide,
  ball: Vec3,
): CameraShot {
  const batted = run?.batted
  if (!batted || !chasingBall(run, nowMs)) return battingShot(aspect, side)
  if (batted.showcase && batted.peaked) return wideShot(batted.landing.spray, batted.landing.distanceDecimetres / 10)
  return chaseShot(ball)
}

/**
 * One frame of the run: the swing cues and then the swings the camera reported since the last frame, in order, then
 * everything due by `realMs`, a hit waiting for the batter when `waitForBatter` (swingStageRun). Slow motion that is
 * over ends first, so a swing made after it converts at full pace.
 */
export function playStageFrame(
  run: StageRun,
  swings: readonly RealTimeSwing[],
  realMs: number,
  reducedMotion: boolean,
  cues: readonly RealTimeSwingCue[] = [],
  waitForBatter = false,
): StageEvent[] {
  endSlowMotion(run, realMs)
  const cueEvents = cues.flatMap((cue) => cueStageSwing(run, cue, realMs))
  const swingEvents = swings.flatMap((swing) => swingStageRun(run, swing, realMs, waitForBatter))
  return [...cueEvents, ...swingEvents, ...advanceStageRun(run, realMs, reducedMotion)]
}
