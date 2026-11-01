import { describe, expect, it, vi } from 'vitest'
import { CHROME_GRAPHICS_SETTINGS, copyStatus, copyText, supportsWebGL } from './webglSupport'

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

  it('reports whether the text reached the clipboard: false with no clipboard or when it refuses', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    expect(await copyText(CHROME_GRAPHICS_SETTINGS, { writeText })).toBe(true)
    expect(writeText).toHaveBeenCalledExactlyOnceWith(CHROME_GRAPHICS_SETTINGS)
    expect(await copyText(CHROME_GRAPHICS_SETTINGS)).toBe(false)
    const denied = { writeText: vi.fn().mockRejectedValue(new Error('Denied')) }
    expect(await copyText(CHROME_GRAPHICS_SETTINGS, denied)).toBe(false)
  })

  it('tells the visitor to copy by hand only once the clipboard failed, and to paste once it worked', () => {
    const messages = { untried: 'untried', copied: 'paste', byHand: 'by hand' }
    expect(copyStatus(null, messages)).toBe('untried')
    expect(copyStatus(true, messages)).toBe('paste')
    expect(copyStatus(false, messages)).toBe('by hand')
  })
})
