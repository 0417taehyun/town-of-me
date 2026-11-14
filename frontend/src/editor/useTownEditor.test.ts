import { describe, expect, it } from 'vitest'
import { SAMPLE_TOWN } from '../testing/sampleTown'
import type { ScheduledBallparkRules, TownSnapshot } from '../data/models'
import { updateObject, withBallparkColor, withBallparkSchedule, withBallparkVisible } from './townEditing'
import { afterSave, rebaseOnSave, type EditorState } from './useTownEditor'

const scheduled: ScheduledBallparkRules = { fromWeek: '2026-12-28', rules: { pitchCount: 8, difficulty: 'hard' } }
// Loaded in the schedule's week before anything was saved in it, so the schedule is due but not yet promoted.
const loaded: TownSnapshot = {
  ...SAMPLE_TOWN,
  venues: { ballpark: { ...SAMPLE_TOWN.venues.ballpark, scheduledRules: scheduled } },
}
const sent = updateObject(loaded, 'house-maple', { position: { x: 4, y: 0, z: 4 } })
// The first save of that week promotes the schedule into the rules in effect.
const saved: TownSnapshot = {
  ...sent,
  venues: { ballpark: { ...SAMPLE_TOWN.venues.ballpark, rules: scheduled.rules } },
  revision: 2,
}
const week = '2026-12-28'

describe('town editor saves', () => {
  it('keeps edits made during a save on the new revision with the venues the backend saved', () => {
    const moved = updateObject(sent, 'house-maple', { position: { x: 6, y: 0, z: 4 } })
    expect(rebaseOnSave(moved, sent, saved, week)).toEqual({ ...moved, venues: saved.venues, revision: 2 })
    expect(rebaseOnSave(sent, sent, saved, week)).toBe(saved)
  })

  it('keeps a color picked and the ballpark shown during a save on the rules it promoted, without its schedule', () => {
    const recolored = withBallparkVisible(withBallparkColor(sent, 'roof', '#e8735a'), true)
    expect(rebaseOnSave(recolored, sent, saved, week).venues.ballpark).toEqual({
      ...saved.venues.ballpark,
      visible: true,
      colors: { roof: '#e8735a' },
    })
  })

  it('keeps a schedule changed during a save, but not a due one an undo during the save brought back', () => {
    const rescheduled = withBallparkSchedule(sent, { pitchCount: 4, difficulty: 'easy' }, week)
    const nextWeek: ScheduledBallparkRules = { fromWeek: '2027-01-04', rules: { pitchCount: 4, difficulty: 'easy' } }
    expect(rebaseOnSave(rescheduled, sent, saved, week).venues.ballpark.scheduledRules).toEqual(nextWeek)
    // Saving next week's schedule promotes this week's too; undoing back to the loaded town brings this week's back.
    const savedWithNextWeek = { ...saved, venues: { ballpark: { ...saved.venues.ballpark, scheduledRules: nextWeek } } }
    expect(rebaseOnSave(loaded, rescheduled, savedWithNextWeek, week).venues.ballpark).toEqual(saved.venues.ballpark)
  })

  it('stops undo at the saved town, so no step resends a promoted schedule or an old revision', () => {
    const recolored = withBallparkColor(sent, 'roof', '#e8735a')
    const moved = updateObject(recolored, 'house-maple', { position: { x: 6, y: 0, z: 4 } })
    // The admin moved a house and saved, then recolored the roof and moved the house again while the save was sent.
    const saving: EditorState = { key: 'town:0', base: loaded, current: moved, history: [loaded, sent, recolored] }
    const next = afterSave(saving, sent, saved, week)
    const steps = [next.current, ...next.history]
    expect(steps.map(({ revision }) => revision)).toEqual([2, 2, 2])
    expect(steps.map(({ venues }) => venues.ballpark.scheduledRules)).toEqual([undefined, undefined, undefined])
    expect(next.history[0]).toBe(next.base)
    expect(afterSave({ ...saving, current: sent, history: [loaded] }, sent, saved, week).history).toEqual([])
  })
})
