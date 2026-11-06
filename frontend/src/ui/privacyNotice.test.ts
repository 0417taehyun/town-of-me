import { describe, expect, it } from 'vitest'
import { SAMPLE_TOWN } from '../testing/sampleTown'
import { linkedLanguage, privacyFacts } from './privacyNotice'

function townShowingBallpark(visible: boolean) {
  const { ballpark } = SAMPLE_TOWN.venues
  return { ...SAMPLE_TOWN, venues: { ...SAMPLE_TOWN.venues, ballpark: { ...ballpark, visible } } }
}

describe('privacy facts', () => {
  it('tells of the derby only while the town is known to show the ballpark', () => {
    expect(privacyFacts(townShowingBallpark(true), 'ko').tellsOfBallpark).toBe(true)
    expect(privacyFacts(townShowingBallpark(false), 'ko').tellsOfBallpark).toBe(false)
    expect(privacyFacts(null, 'ko').tellsOfBallpark).toBe(false)
  })

  it('reads a blank owner name or contact as none, so the page shows its fallback', () => {
    const owner = { ...SAMPLE_TOWN.owner, name: { ko: '  ', en: 'Mira' }, contactEmail: ' ' }
    const town = { ...SAMPLE_TOWN, owner }
    expect(privacyFacts(town, 'ko')).toMatchObject({ operatorName: null, contactEmail: null })
    expect(privacyFacts(town, 'en').operatorName).toBe('Mira')
  })
})

describe('linked language', () => {
  it('keeps only a language this build knows', () => {
    expect(linkedLanguage('?lang=en')).toBe('en')
    expect(linkedLanguage('?lang=fr')).toBeNull()
    expect(linkedLanguage('')).toBeNull()
  })
})
