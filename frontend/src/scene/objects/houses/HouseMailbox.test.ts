import { describe, expect, it } from 'vitest'
import { linkedInProfileUrlError, normalizeLinkedInProfileUrl } from '../../../data/linkedInProfile'

describe('house LinkedIn profile links', () => {
  it('accepts only HTTPS LinkedIn member profile URLs', () => {
    expect(normalizeLinkedInProfileUrl('https://www.linkedin.com/in/town-resident')).toBe(
      'https://www.linkedin.com/in/town-resident',
    )
    expect(normalizeLinkedInProfileUrl('https://linkedin.com/in/town-resident/details/?trk=public')).toBe(
      'https://www.linkedin.com/in/town-resident',
    )
    expect(normalizeLinkedInProfileUrl('javascript:alert(1)')).toBeNull()
    expect(normalizeLinkedInProfileUrl('https://example.com/in/town-resident')).toBeNull()
    expect(normalizeLinkedInProfileUrl('https://www.linkedin.com/company/example')).toBeNull()
    expect(linkedInProfileUrlError('')).toBeNull()
    expect(linkedInProfileUrlError('https://www.linkedin.com/in/town-resident')).toBeNull()
    expect(linkedInProfileUrlError('https://example.com/in/town-resident')).toBe('Enter a valid LinkedIn profile URL.')
  })
})
