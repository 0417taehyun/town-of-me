import { describe, expect, it, vi } from 'vitest'
import { CHROME_GRAPHICS_SETTINGS, copyGraphicsSettingsAddress, supportsWebGL } from './webglSupport'

describe('WebGL capability preflight', () => {
  it('reports unsupported or blocked contexts without leaking renderer details', () => {
    expect(supportsWebGL(() => null)).toBe(false)
    expect(
      supportsWebGL(() => {
        throw new Error('Driver-specific details')
      }),
    ).toBe(false)
  })
  it('releases its probe context, with no GPU identity query or security-setting changes', () => {
    const loseContext = vi.fn()
    const getExtension = vi.fn(() => ({ loseContext }))
    expect(supportsWebGL(() => ({ getExtension }))).toBe(true)
    expect(getExtension).toHaveBeenCalledExactlyOnceWith('WEBGL_lose_context')
    expect(loseContext).toHaveBeenCalledOnce()
    expect(supportsWebGL(() => ({ getExtension: () => null }))).toBe(true)
  })

  it('copies the real Chrome settings address and provides a manual path when clipboard access is blocked', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    expect(await copyGraphicsSettingsAddress({ writeText })).toContain('Address copied')
    expect(writeText).toHaveBeenCalledExactlyOnceWith(CHROME_GRAPHICS_SETTINGS)
    expect(await copyGraphicsSettingsAddress()).toContain('Select and copy')
    expect(await copyGraphicsSettingsAddress({ writeText: vi.fn().mockRejectedValue(new Error('Denied')) })).toContain(
      'Select and copy',
    )
  })
})
