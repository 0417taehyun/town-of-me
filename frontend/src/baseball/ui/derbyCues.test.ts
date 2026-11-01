import { describe, expect, it } from 'vitest'
import { languageCopy } from '../../i18n/language'
import { advanceDerby, createDerby, type Derby, type DerbyEvent, phaseEndMs, swingDerby } from '../game/derby'
import { contactHeight, contactSeconds, type PitchTypeId } from '../game/pitch'
import type { PitchResult } from '../game/derbyScore'
import { createRunPlan, planRunPitch, type RunPlan } from '../game/runPlan'
import type { StageEvent } from '../stage/stageRun'
import {
  bannerResult,
  bannerText,
  betweenPitches,
  cameraPanelWords,
  chasingHomeRun,
  type DerbyHudState,
  distanceText,
  homeRunDistanceText,
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
  it('names each pitch only once its ball is down, never while that one or the next is wound up or on its way', () => {
    const plan = createRunPlan({ pitchCount: 3, difficulty: 'normal' }, 11)
    let derby = createDerby(plan, { side: 'right', practice: [] }, 0)
    let hud = NEW_RUN_HUD
    const named: Array<[StageEvent['type'], PitchTypeId | null]> = []
    for (let nowMs = 0; derby.phase !== 'finished'; nowMs += 16) {
      const update = advanceDerby(derby, nowMs)
      derby = update.derby
      update.events.flatMap(stageEventsFor).forEach((event) => {
        hud = hudAfterEvent(hud, event)
        named.push([event.type, bannerResult(hud)?.pitchType ?? null])
      })
    }
    const pitchTypes = plan.schedule.map((pitch) => pitch.type)
    expect(named).toEqual([
      ...pitchTypes.flatMap((type) => [
        ['windup', null],
        ['release', null],
        ['result', null],
        ['caught', type],
      ]),
      ['finished', null],
    ])
  })

  it('adds a home run and its distance to the scoreboard as its banner shows, not when the bat meets the ball', () => {
    let hud = NEW_RUN_HUD
    const scoreboard = deadOnRun(createRunPlan({ pitchCount: 3, difficulty: 'normal' }, 11)).map((event) => {
      hud = hudAfterEvent(hud, event)
      const { homeRuns, homeRunDistanceDecimetres } = scoreboardTotals(hud)
      return { type: event.type, homeRuns, distance: homeRunDistanceDecimetres, banner: bannerResult(hud) }
    })
    expect(scoreboard.map((row) => [row.type, row.homeRuns])).toEqual([
      ...[0, 1, 2].flatMap((before) => [
        ['windup', before],
        ['release', before],
        ['result', before],
        ['chase', before],
        ['landed', before + 1],
      ]),
      ['finished', 3],
    ])
    const landed = scoreboard.filter((row) => row.type === 'landed')
    const distances = landed.map((row) => row.banner?.distanceDecimetres ?? 0)
    expect(landed.map((row) => row.distance)).toEqual(
      distances.map((_, index) => distances.slice(0, index + 1).reduce((total, distance) => total + distance, 0)),
    )
  })

  it('chases a home run once the camera does, not from its result, until its ball is down, and no other ball', () => {
    let hud = NEW_RUN_HUD
    const chased = deadOnRun(createRunPlan({ pitchCount: 3, difficulty: 'normal' }, 11)).map((event) => {
      hud = hudAfterEvent(hud, event)
      return [event.type, chasingHomeRun(hud)]
    })
    expect(chased).toEqual([
      ...[0, 1, 2].flatMap(() => [
        ['windup', false],
        ['release', false],
        ['result', false],
        ['chase', true],
        ['landed', false],
      ]),
      ['finished', false],
    ])
    const hit = { ...hud.results[0], outcome: 'hit' as const }
    const hitInTheAir: DerbyHudState = {
      phase: 'result',
      pitchIndex: 0,
      results: [hit],
      chasedPitch: 0,
      settledPitch: -1,
    }
    expect(chasingHomeRun(hitInTheAir)).toBe(false)
  })

  it('pops up the outcome as the camera chases the ball or the mitt catches the pitch, never at its result', () => {
    const plan = createRunPlan({ pitchCount: 3, difficulty: 'normal' }, 11)
    let hud = NEW_RUN_HUD
    const titles = (events: StageEvent[]) =>
      events.map((event) => {
        hud = hudAfterEvent(hud, event)
        return [event.type, outcomeTitle(hud)]
      })
    expect(titles(deadOnRun(plan))).toEqual([
      ...[0, 1, 2].flatMap(() => [
        ['windup', null],
        ['release', null],
        ['result', null],
        ['chase', 'homeRun'],
        ['landed', 'homeRun'],
      ]),
      ['finished', null],
    ])
    hud = NEW_RUN_HUD
    expect(titles(deadOnRun(plan, false))).toEqual([
      ...[0, 1, 2].flatMap(() => [
        ['windup', null],
        ['release', null],
        ['result', null],
        ['caught', 'strike'],
      ]),
      ['finished', null],
    ])
    const swungAndMissed = { ...hud.results[0], timing: 'early' as const }
    const caught: DerbyHudState = { ...hud, phase: 'result', results: [swungAndMissed], settledPitch: 0 }
    expect(outcomeTitle(caught)).toBe('miss')
    expect(outcomeTitle({ ...caught, settledPitch: -1 })).toBe(null)
  })

  it('is between pitches before the first windup and once a ball is down, never with one on its way or after the last', () => {
    let hud = NEW_RUN_HUD
    expect(betweenPitches(hud, 3)).toBe(true)
    const between = deadOnRun(createRunPlan({ pitchCount: 3, difficulty: 'normal' }, 11)).map((event) => {
      hud = hudAfterEvent(hud, event)
      return [event.type, betweenPitches(hud, 3)]
    })
    expect(between).toEqual([
      ...[true, true, false].flatMap((another) => [
        ['windup', false],
        ['release', false],
        ['result', false],
        ['chase', false],
        ['landed', another],
      ]),
      ['finished', false],
    ])
  })

  it('keeps a pitch in play from its windup until its ball is down, through the swing it was judged by', () => {
    let hud = NEW_RUN_HUD
    expect(pitchInPlay(hud)).toBe(false)
    const inPlay = deadOnRun(createRunPlan({ pitchCount: 3, difficulty: 'normal' }, 11)).map((event) => {
      hud = hudAfterEvent(hud, event)
      return [event.type, pitchInPlay(hud)]
    })
    expect(inPlay).toEqual([
      ...[0, 1, 2].flatMap(() => [
        ['windup', true],
        ['release', true],
        ['result', true],
        ['chase', true],
        ['landed', false],
      ]),
      ['finished', false],
    ])
  })

  it('colours each pitch dot only once its ball is down, ringing the pitch up next until then', () => {
    let hud = NEW_RUN_HUD
    expect(pitchDots(hud, 3)).toEqual(['current', 'coming', 'coming'])
    const dots = deadOnRun(createRunPlan({ pitchCount: 3, difficulty: 'normal' }, 11)).map((event) => {
      hud = hudAfterEvent(hud, event)
      return [event.type, pitchDots(hud, 3)]
    })
    const pitches = [
      [
        ['current', 'coming', 'coming'],
        ['homeRun', 'coming', 'coming'],
      ],
      [
        ['homeRun', 'current', 'coming'],
        ['homeRun', 'homeRun', 'coming'],
      ],
      [
        ['homeRun', 'homeRun', 'current'],
        ['homeRun', 'homeRun', 'homeRun'],
      ],
    ]
    expect(dots).toEqual([
      ...pitches.flatMap(([inPlay, down]) => [
        ['windup', inPlay],
        ['release', inPlay],
        ['result', inPlay],
        ['chase', inPlay],
        ['landed', down],
      ]),
      ['finished', ['homeRun', 'homeRun', 'homeRun']],
    ])
  })

  it('names the distance and the pitch in the banner, never how the swing was timed', () => {
    const landing = { outcome: 'homeRun', distanceDecimetres: 1203, spray: 0.1, launchDegrees: 28 } as const
    const deadOn: PitchResult = { ...landing, pitchType: 'curve', timing: 'perfect', errorMs: 3 }
    const lateSwing: PitchResult = { ...deadOn, timing: 'late', errorMs: 120 }
    expect(bannerText(lateSwing, 'en')).toEqual(bannerText(deadOn, 'en'))
    expect(bannerText(lateSwing, 'ko')).toEqual(bannerText(deadOn, 'ko'))
    expect(bannerText({ ...deadOn, pitchType: 'fastball' }, 'en')).not.toEqual(bannerText(deadOn, 'en'))
  })

  it('shows distances in whole meters, spaced in English and not in Korean, and a total to the decimeter', () => {
    expect([distanceText(1324, 'en'), distanceText(1324, 'ko')]).toEqual(['132 m', '132m'])
    expect([homeRunDistanceText(2170, 'en', 1), homeRunDistanceText(2174, 'en', 1)]).toEqual(['217.0 m', '217.4 m'])
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
