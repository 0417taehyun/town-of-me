import { describe, expect, it } from 'vitest'
import { advanceDerby, createDerby, type DerbyEvent } from '../game/derby'
import type { PitchTypeId } from '../game/pitch'
import { createRunPlan } from '../game/runPlan'
import type { StageEvent } from '../stage/stageRun'
import { bannerResult, distanceText, homeRunDistanceText, hudAfterEvent, NEW_RUN_HUD } from './derbyCues'

/** What the stage reports for a derby event: a result, then the ball coming down (here, into the mitt). */
function stageEventsFor(event: DerbyEvent): StageEvent[] {
  if (event.type !== 'result') return [event]
  return [event, { type: 'caught', pitchIndex: event.pitchIndex }]
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

  it('shows distances in whole meters, spaced in English and not in Korean, and a total to the decimeter', () => {
    expect([distanceText(1324, 'en'), distanceText(1324, 'ko')]).toEqual(['132 m', '132m'])
    expect([homeRunDistanceText(2170, 'en', 1), homeRunDistanceText(2174, 'en', 1)]).toEqual(['217 m', '217.4 m'])
  })
})
