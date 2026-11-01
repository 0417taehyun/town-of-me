import { describe, expect, it } from 'vitest'
import type { PitchResult } from '../game/derbyScore'
import { hudAfterEvent, NEW_RUN_HUD } from '../ui/derbyCues'
import { scoreboardSummary } from './scoreboard'

const homeRun = (distanceDecimetres: number): PitchResult => ({
  outcome: 'homeRun',
  distanceDecimetres,
  spray: 0,
  launchDegrees: 30,
  pitchType: 'curve',
  timing: 'perfect',
  errorMs: 0,
})

describe('the treehouse scoreboard', () => {
  it('waits for each ball to come down before it fills a star or counts a home run', () => {
    const first = hudAfterEvent(NEW_RUN_HUD, { type: 'result', pitchIndex: 0, result: homeRun(1180), swing: null })
    expect(scoreboardSummary(first, 5)).toEqual({ pitches: 5, played: 0, homeRuns: 0, lastHomeRunDecimetres: null })
    const landed = hudAfterEvent(first, { type: 'landed', pitchIndex: 0 })
    const second = hudAfterEvent(landed, { type: 'result', pitchIndex: 1, result: homeRun(1320), swing: null })
    expect(scoreboardSummary(second, 5)).toEqual({ pitches: 5, played: 1, homeRuns: 1, lastHomeRunDecimetres: 1180 })
  })
})
