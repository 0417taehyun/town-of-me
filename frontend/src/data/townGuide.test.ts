import { describe, expect, it } from 'vitest'
import { SAMPLE_TOWN } from '../testing/sampleTown'
import { getGuideBench, nextTownGuideStep } from './townGuide'

describe('first visit town guide', () => {
  it('advances only after the action for the current step', () => {
    expect(nextTownGuideStep('move', 'sat-on-bench', true)).toBe('move')
    expect(nextTownGuideStep('move', 'moved', true)).toBe('glance')
    expect(nextTownGuideStep('glance', 'glanced', true)).toBe('view')
    expect(nextTownGuideStep('view', 'adjusted-view', true)).toBe('bench')
    expect(nextTownGuideStep('bench', 'sat-on-bench', true)).toBe('photo')
    expect(nextTownGuideStep('photo', 'tried-photo', true)).toBe('pet')
    expect(nextTownGuideStep('pet', 'greeted-pet', true)).toBe('resident')
    expect(nextTownGuideStep('resident', 'heard-owner-reference', true)).toBe('guestbook')
  })

  it('skips the resident task in an empty town and ends after the guestbook', () => {
    expect(nextTownGuideStep('pet', 'greeted-pet', false)).toBe('guestbook')
    expect(nextTownGuideStep('guestbook', 'visited-guestbook', true)).toBe('inactive')
  })

  it('points to the closest bench not assigned to a resident', () => {
    const bench = getGuideBench(SAMPLE_TOWN)
    expect(bench?.type).toBe('bench')
    expect(SAMPLE_TOWN.residents.map(({ benchId }) => benchId)).not.toContain(bench?.id)
  })
})
