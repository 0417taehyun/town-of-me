import { describe, expect, it } from 'vitest'
import { advanceDerby, createDerby, type Derby, type DerbyEvent, phaseEndMs, swingDerby } from '../game/derby'
import { contactSeconds, type PitchTypeId } from '../game/pitch'
import { createRunPlan, planRunPitch, type RunPlan } from '../game/runPlan'
import type { StageEvent } from '../stage/stageRun'
import {
  bannerResult,
  distanceText,
  homeRunDistanceText,
  hudAfterEvent,
  NEW_RUN_HUD,
  scoreboardTotals,
} from './derbyCues'

/** What the stage reports for a derby event: a result, then the ball coming down, into the mitt or onto the grass. */
function stageEventsFor(event: DerbyEvent): StageEvent[] {
  if (event.type !== 'result') return [event]
  const settled = event.result.outcome === 'miss' ? 'caught' : 'landed'
  return [event, { type: settled, pitchIndex: event.pitchIndex }]
}

/** A key pressed the moment the pitch on its way reaches the contact point. */
function swingDeadOn(derby: Derby) {
  const contactAtMs = derby.phaseStartedMs + contactSeconds(planRunPitch(derby.plan, derby.pitchIndex)) * 1000
  return swingDerby(derby, { source: 'keyboard', contactAtMs, startedAtMs: contactAtMs, speed: 0, heightError: null })
}

/** The stage events of a keyboard run swung dead on at every pitch. */
function deadOnRun(plan: RunPlan) {
  let derby = createDerby(plan, { input: 'keyboard', side: 'right', practice: [] }, 0)
  const events: DerbyEvent[] = []
  while (derby.phase !== 'finished') {
    const update = derby.phase === 'pitch' ? swingDeadOn(derby) : advanceDerby(derby, phaseEndMs(derby) ?? 0)
    derby = update.derby
    events.push(...update.events)
  }
  return events.flatMap(stageEventsFor)
}

describe('the derby HUD', () => {
  it('names each pitch only once its ball is down, never while that one or the next is wound up or on its way', () => {
    const plan = createRunPlan({ pitchCount: 3, difficulty: 'normal' }, 11)
    let derby = createDerby(plan, { input: 'keyboard', side: 'right', practice: [] }, 0)
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

  it('shows distances in whole meters, spaced in English and not in Korean, and a total to the decimeter', () => {
    expect([distanceText(1324, 'en'), distanceText(1324, 'ko')]).toEqual(['132 m', '132m'])
    expect([homeRunDistanceText(2170, 'en', 1), homeRunDistanceText(2174, 'en', 1)]).toEqual(['217 m', '217.4 m'])
  })
})
