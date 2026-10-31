import { describe, expect, it } from 'vitest'
import { SAMPLE_TOWN } from '../testing/sampleTown'
import type { ScheduledBallparkRules, TownSnapshot } from '../data/models'
import { updateObject, withBallparkColor, withBallparkSchedule } from './townEditing'
import { afterSave, rebaseOnSave, type EditorState } from './useTownEditor'

const scheduled: ScheduledBallparkRules = { fromMonth: '2026-12', rules: { pitchCount: 8, difficulty: 'hard' } }
// Loaded in December before anything was saved that month, so the schedule is due but not yet promoted.
const loaded: TownSnapshot = {
  ...SAMPLE_TOWN,
  venues: { ballpark: { ...SAMPLE_TOWN.venues.ballpark, scheduledRules: scheduled } },
}
const sent = updateObject(loaded, 'house-maple', { position: { x: 4, y: 0, z: 4 } })
// The first save of December promotes the schedule into the rules in effect.
const saved: TownSnapshot = {
  ...sent,
  venues: { ballpark: { ...SAMPLE_TOWN.venues.ballpark, rules: scheduled.rules } },
  revision: 2,
}
const month = '2026-12'

describe('town editor saves', () => {
  it('keeps edits made during a save on the new revision with the venues the backend saved', () => {
    const moved = updateObject(sent, 'house-maple', { position: { x: 6, y: 0, z: 4 } })
    expect(rebaseOnSave(moved, sent, saved, month)).toEqual({ ...moved, venues: saved.venues, revision: 2 })
    expect(rebaseOnSave(sent, sent, saved, month)).toBe(saved)
  })

  it('keeps a color picked during a save on the rules it promoted, without resending the promoted schedule', () => {
    const recolored = withBallparkColor(sent, 'roof', '#e8735a')
    expect(rebaseOnSave(recolored, sent, saved, month).venues.ballpark).toEqual({
      ...saved.venues.ballpark,
      colors: { roof: '#e8735a' },
    })
  })

  it('keeps a schedule changed during a save, but not a due one an undo during the save brought back', () => {
    const rescheduled = withBallparkSchedule(sent, { pitchCount: 4, difficulty: 'easy' }, month)
    const january: ScheduledBallparkRules = { fromMonth: '2027-01', rules: { pitchCount: 4, difficulty: 'easy' } }
    expect(rebaseOnSave(rescheduled, sent, saved, month).venues.ballpark.scheduledRules).toEqual(january)
    // Saving January's schedule promotes December's too; undoing back to the loaded town brings December's back.
    const savedWithJanuary = { ...saved, venues: { ballpark: { ...saved.venues.ballpark, scheduledRules: january } } }
    expect(rebaseOnSave(loaded, rescheduled, savedWithJanuary, month).venues.ballpark).toEqual(saved.venues.ballpark)
  })

  it('stops undo at the saved town, so no step resends a promoted schedule or an old revision', () => {
    const recolored = withBallparkColor(sent, 'roof', '#e8735a')
    const moved = updateObject(recolored, 'house-maple', { position: { x: 6, y: 0, z: 4 } })
    // The admin moved a house and saved, then recolored the roof and moved the house again while the save was sent.
    const saving: EditorState = { key: 'town:0', base: loaded, current: moved, history: [loaded, sent, recolored] }
    const next = afterSave(saving, sent, saved, month)
    const steps = [next.current, ...next.history]
    expect(steps.map(({ revision }) => revision)).toEqual([2, 2, 2])
    expect(steps.map(({ venues }) => venues.ballpark.scheduledRules)).toEqual([undefined, undefined, undefined])
    expect(next.history[0]).toBe(next.base)
    expect(afterSave({ ...saving, current: sent, history: [loaded] }, sent, saved, month).history).toEqual([])
  })
})
