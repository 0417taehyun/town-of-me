import { describe, expect, it } from 'vitest'
import { SAMPLE_TOWN } from '../testing/sampleTown'
import type { ScheduledBallparkRules, TownSnapshot } from '../data/models'
import { updateObject } from './townEditing'
import { rebaseOnSave } from './useTownEditor'

const scheduled: ScheduledBallparkRules = { fromMonth: '2026-12', rules: { pitchCount: 8, difficulty: 'hard' } }
const sent: TownSnapshot = {
  ...SAMPLE_TOWN,
  venues: { ballpark: { ...SAMPLE_TOWN.venues.ballpark, scheduledRules: scheduled } },
}
// The first save of December promotes the schedule into the rules in effect.
const saved: TownSnapshot = {
  ...SAMPLE_TOWN,
  venues: { ballpark: { ...SAMPLE_TOWN.venues.ballpark, rules: scheduled.rules } },
  revision: 2,
}

describe('town editor saves', () => {
  it('keeps edits made during a save on the new revision with the venues the backend saved', () => {
    const moved = updateObject(sent, 'house-maple', { position: { x: 4, y: 0, z: 4 } })
    expect(rebaseOnSave(moved, sent, saved)).toEqual({ ...moved, venues: saved.venues, revision: 2 })
    expect(rebaseOnSave(sent, sent, saved)).toBe(saved)
  })

  it('keeps a venue edit made during a save', () => {
    const recolored = { ...sent, venues: { ballpark: { ...sent.venues.ballpark, colors: { roof: '#e8735a' } } } }
    expect(rebaseOnSave(recolored, sent, saved)).toEqual({ ...recolored, revision: 2 })
  })
})
