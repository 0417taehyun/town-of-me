import { describe, expect, it } from 'vitest'
import { languageCopy } from '../../i18n/language'
import { advanceDerby, createDerby, type Derby, type DerbyEvent, phaseEndMs, swingDerby } from '../game/derby'
import { contactHeight, contactSeconds } from '../game/pitch'
import type { PitchResult } from '../game/derbyScore'
import { createRunPlan, planRunPitch, type RunPlan } from '../game/runPlan'
import { scoreboardSummary } from '../stadium/scoreboard'
import type { StageEvent } from '../stage/stageRun'
import {
  bannerResult,
  betweenPitches,
  cameraPanelWords,
  captionId,
  captionShown,
  chasingHomeRun,
  type DerbyHudState,
  hudAfterEvent,
  NEW_RUN_HUD,
  outcomeTitle,
  pitchDots,
  pitchInPlay,
  resultRow,
  scoreboardTotals,
  seenCameraState,
  stanceNeedText,
  stanceTicked,
} from './derbyCues'

/**
 * What the stage reports for a derby event: a result, then the ball coming down, into the mitt, or onto the grass once
 * the camera has started chasing it.
 */
function stageEventsFor(event: DerbyEvent): StageEvent[] {
  if (event.type !== 'result') return [event]
  const { pitchIndex } = event
  if (event.result.outcome === 'miss') return [event, { type: 'caught', pitchIndex }]
  return [event, { type: 'chase', pitchIndex }, { type: 'landed', pitchIndex }]
}

/** The HUD after each of `events`, in turn. */
function hudsAfter(events: StageEvent[]) {
  let hud = NEW_RUN_HUD
  return events.map((event) => {
    hud = hudAfterEvent(hud, event)
    return hud
  })
}

/**
 * What a 3-pitch run's HUD shows: the pitch the banner names, the big title, whether it chases a home run, is between
 * pitches, or has a pitch in play, the pitch dots, and the scoreboard's filled stars and home runs.
 */
function hudRow(hud: DerbyHudState) {
  return [
    bannerResult(hud)?.pitchType ?? null,
    outcomeTitle(hud),
    chasingHomeRun(hud),
    betweenPitches(hud, 3),
    pitchInPlay(hud),
    pitchDots(hud, 3),
    scoreboardSummary(hud, 3).played,
    scoreboardTotals(hud).homeRuns,
  ]
}

/** Each of `events` with what the HUD shows after it. */
function hudTimeline(events: StageEvent[]) {
  return hudsAfter(events).map((hud, index) => [events[index].type, ...hudRow(hud)])
}

/** Whether the caption showed over the play after each of `events`, with the visitor in view. */
function captionsShown(events: StageEvent[]) {
  return hudsAfter(events).map((hud) => captionShown(captionId(hud), false))
}

/** A swing with the bat level with the ball the moment the pitch on its way reaches the contact point. */
function swingDeadOn(derby: Derby) {
  const pitch = planRunPitch(derby.plan, derby.pitchIndex)
  const contactAtMs = derby.phaseStartedMs + contactSeconds(pitch) * 1000
  const batHeight = contactHeight(pitch)
  return swingDerby(derby, { contactAtMs, startedAtMs: contactAtMs - 200, speed: 8, batHeight })
}

/** The stage events of a run swung dead on at every pitch, or with `swings` false, of one letting every pitch go by. */
function deadOnRun(plan: RunPlan, swings = true) {
  let derby = createDerby(plan, { side: 'right', practice: [] }, 0)
  const events: DerbyEvent[] = []
  while (derby.phase !== 'finished') {
    const swinging = swings && derby.phase === 'pitch'
    const update = swinging ? swingDeadOn(derby) : advanceDerby(derby, phaseEndMs(derby) ?? 0)
    derby = update.derby
    events.push(...update.events)
  }
  return events.flatMap(stageEventsFor)
}

describe('the derby HUD', () => {
  it('follows a run swung dead on: a home run’s title once the camera chases it, its name, dot and count once down', () => {
    const plan = createRunPlan({ pitchCount: 3, difficulty: 'normal' }, 11)
    const events = deadOnRun(plan)
    const inPlay = [
      ['current', 'coming', 'coming'],
      ['homeRun', 'current', 'coming'],
      ['homeRun', 'homeRun', 'current'],
    ]
    const down = [
      ['homeRun', 'coming', 'coming'],
      ['homeRun', 'homeRun', 'coming'],
      ['homeRun', 'homeRun', 'homeRun'],
    ]
    expect(hudRow(NEW_RUN_HUD)).toEqual([null, null, false, true, false, inPlay[0], 0, 0])
    // The event, then the banner's pitch, the title, chasing, between pitches, in play, the dots, stars and home runs.
    expect(hudTimeline(events)).toEqual([
      ...plan.schedule.flatMap(({ type }, index) => [
        ['windup', null, null, false, false, true, inPlay[index], index, index],
        ['release', null, null, false, false, true, inPlay[index], index, index],
        ['result', null, null, false, false, true, inPlay[index], index, index],
        ['chase', null, 'homeRun', true, false, true, inPlay[index], index, index],
        ['landed', type, 'homeRun', false, index < 2, false, down[index], index + 1, index + 1],
      ]),
      ['finished', null, null, false, false, false, down[2], 3, 3],
    ])
    const huds = hudsAfter(events)
    const landed = huds.filter((_, index) => events[index].type === 'landed')
    const distances = landed.map((hud) => bannerResult(hud)?.distanceDecimetres ?? 0)
    expect(landed.map((hud) => scoreboardTotals(hud).homeRunDistanceDecimetres)).toEqual(
      distances.map((_, index) => distances.slice(0, index + 1).reduce((total, distance) => total + distance, 0)),
    )
    const hit = { ...landed[0].results[0], outcome: 'hit' as const }
    const hitInTheAir: DerbyHudState = {
      phase: 'result',
      pitchIndex: 0,
      results: [hit],
      chasedPitch: 0,
      settledPitch: -1,
    }
    expect(chasingHomeRun(hitInTheAir)).toBe(false)
  })

  it('follows a run let go by: a strike’s title, name, dot and star once the mitt has it, never while on its way', () => {
    const plan = createRunPlan({ pitchCount: 3, difficulty: 'normal' }, 11)
    const events = deadOnRun(plan, false)
    const inPlay = [
      ['current', 'coming', 'coming'],
      ['out', 'current', 'coming'],
      ['out', 'out', 'current'],
    ]
    const down = [
      ['out', 'coming', 'coming'],
      ['out', 'out', 'coming'],
      ['out', 'out', 'out'],
    ]
    expect(hudTimeline(events)).toEqual([
      ...plan.schedule.flatMap(({ type }, index) => [
        ['windup', null, null, false, false, true, inPlay[index], index, 0],
        ['release', null, null, false, false, true, inPlay[index], index, 0],
        ['result', null, null, false, false, true, inPlay[index], index, 0],
        ['caught', type, 'strike', false, index < 2, false, down[index], index + 1, 0],
      ]),
      ['finished', null, null, false, false, false, down[2], 3, 0],
    ])
    const hud = hudsAfter(events).at(-1) ?? NEW_RUN_HUD
    const swungAndMissed = { ...hud.results[0], timing: 'early' as const }
    const caught: DerbyHudState = { ...hud, phase: 'result', results: [swungAndMissed], settledPitch: 0 }
    expect(outcomeTitle(caught)).toBe('miss')
    expect(outcomeTitle({ ...caught, settledPitch: -1 })).toBe(null)
  })

  it('shows the caption over the play for a pause or a practice word, never over a pitch nor with an outcome title', () => {
    const plan = createRunPlan({ pitchCount: 3, difficulty: 'normal' }, 11)
    expect(captionsShown(deadOnRun(plan))).not.toContain(true)
    expect(captionsShown(deadOnRun(plan, false))).not.toContain(true)
    expect(captionShown(captionId(NEW_RUN_HUD), true)).toBe(true)
    expect((['early', 'good', 'late', 'letGo'] as const).every((id) => captionShown(id, false))).toBe(true)
  })
})

describe('the result card', () => {
  it('names how each pitch ended, with a distance to the decimeter only for a ball in play, never its timing', () => {
    const landing = { outcome: 'homeRun', distanceDecimetres: 1324, spray: 0.1, launchDegrees: 28 } as const
    const homeRun: PitchResult = { ...landing, pitchType: 'curve', timing: 'perfect', errorMs: 3 }
    const pitches: PitchResult[] = [
      homeRun,
      { ...homeRun, outcome: 'hit', distanceDecimetres: 612, timing: 'late', errorMs: 90 },
      { ...homeRun, outcome: 'foul', distanceDecimetres: 380 },
      { ...homeRun, outcome: 'miss', distanceDecimetres: 0, timing: 'early', errorMs: -260 },
      { ...homeRun, outcome: 'miss', distanceDecimetres: 0, timing: null, errorMs: null },
    ]
    expect(pitches.map((pitch) => resultRow(pitch, 'en'))).toEqual([
      { outcome: 'homeRun', distance: '132.4 m' },
      { outcome: 'hit', distance: '61.2 m' },
      { outcome: 'foul', distance: null },
      { outcome: 'miss', distance: null },
      { outcome: 'strike', distance: null },
    ])
  })
})

describe('the stance gauge', () => {
  it('ticks at each whole second it fills past, never at full, draining, or starting over', () => {
    const ticks = (steps: number[]) => steps.slice(1).filter((after, index) => stanceTicked(steps[index], after)).length
    expect(ticks([0, 0.2, 0.34, 0.5, 0.67, 0.9, 1])).toBe(2)
    expect(ticks([0.9, 0.5, 0.2, 0])).toBe(0)
    expect(ticks([0.5, 0, 0.1, 0.4])).toBe(1)
  })
})

describe('the camera chip', () => {
  it('never tells a visitor to swing while a step waits for the stance, but still says how the lock goes', () => {
    const tracker = languageCopy.en.baseball.camera.tracker
    const waiting = stanceNeedText('hold', 'right', 'en')
    const swingWords = (['loaded', 'swing', 'pullBack', 'faster'] as const).map((caption) =>
      seenCameraState(caption, waiting, 'en'),
    )
    expect(swingWords).toEqual([waiting, waiting, waiting, waiting])
    expect(seenCameraState('locking', waiting, 'en')).toBe(tracker.locking)
    // In practice and a run, where no step waits, the tracker says when to swing.
    expect(seenCameraState('loaded', null, 'en')).toBe(tracker.loaded)
  })

  it('pops for a swing and reds a sweep to fix in play, but only says loaded or ready while the stance is held', () => {
    const waiting = stanceNeedText('hold', 'right', 'en')
    const tones = (need: string | null) =>
      (['loaded', 'swing', 'faster', 'showHands'] as const).map(
        (caption) => cameraPanelWords('seen', caption, need, 'en')?.tone,
      )
    expect(tones(null)).toEqual(['loaded', 'swing', 'help', 'help'])
    expect(tones(waiting)).toEqual(['loaded', 'locked', 'locked', 'help'])
    // A caption left from before the visitor stepped away never colours the chip while the camera looks for them.
    expect(cameraPanelWords('searching', 'swing', null, 'en')?.tone).toBe('searching')
  })
})
