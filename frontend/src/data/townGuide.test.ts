import { describe, expect, it } from 'vitest'
import { SAMPLE_TOWN } from '../testing/sampleTown'
import { getGuideBench, nextTownGuideStep } from './townGuide'

const town = { hasResidents: true, canSkid: true }

describe('first visit town guide', () => {
  it('advances only after the action for the current step', () => {
    expect(nextTownGuideStep('move', 'sat-on-bench', town)).toBe('move')
    expect(nextTownGuideStep('move', 'moved', town)).toBe('run')
    expect(nextTownGuideStep('run', 'moved', town)).toBe('run')
    expect(nextTownGuideStep('run', 'skidded', town)).toBe('glance')
    expect(nextTownGuideStep('glance', 'glanced', town)).toBe('view')
    expect(nextTownGuideStep('view', 'adjusted-view', town)).toBe('bench')
    expect(nextTownGuideStep('bench', 'sat-on-bench', town)).toBe('photo')
    expect(nextTownGuideStep('photo', 'tried-photo', town)).toBe('appearance')
    expect(nextTownGuideStep('appearance', 'opened-environment', town)).toBe('appearance')
    expect(nextTownGuideStep('appearance', 'opened-character', town)).toBe('environment')
    expect(nextTownGuideStep('environment', 'opened-character', town)).toBe('environment')
    expect(nextTownGuideStep('environment', 'opened-environment', town)).toBe('pet')
    expect(nextTownGuideStep('pet', 'greeted-pet', town)).toBe('resident')
    expect(nextTownGuideStep('resident', 'heard-owner-reference', town)).toBe('guestbook')
  })

  it('skips a lesson the town cannot offer, such as skids turned off or no residents, and ends after the guestbook', () => {
    const noSkids = { ...town, canSkid: false }
    expect(nextTownGuideStep('move', 'moved', noSkids)).toBe('glance')
    expect(nextTownGuideStep('run', 'glanced', noSkids)).toBe('glance')
    expect(nextTownGuideStep('pet', 'greeted-pet', { ...town, hasResidents: false })).toBe('guestbook')
    expect(nextTownGuideStep('guestbook', 'visited-guestbook', town)).toBe('inactive')
  })

  it('points to the closest bench not assigned to a resident', () => {
    const bench = getGuideBench(SAMPLE_TOWN)
    expect(bench?.type).toBe('bench')
    expect(SAMPLE_TOWN.residents.map(({ benchId }) => benchId)).not.toContain(bench?.id)
  })
})
