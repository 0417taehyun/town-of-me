import { describe, expect, it } from 'vitest'
import { getContactShadowFade } from './contactShadow'

describe('contact shadows', () => {
  it('is full on the ground, fades as the body rises, and is gone well above it', () => {
    expect(getContactShadowFade(0)).toBe(1)
    expect(getContactShadowFade(-0.2)).toBe(1)
    expect(getContactShadowFade(0.3)).toBeLessThan(1)
    expect(getContactShadowFade(0.6)).toBeLessThan(getContactShadowFade(0.3))
    expect(getContactShadowFade(0.6)).toBeGreaterThan(0)
    expect(getContactShadowFade(5)).toBe(0)
  })
})
