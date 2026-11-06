import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { GraphicsCanvas } from './GraphicsCanvas'

describe('non-WebGL UI', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('announces a fallback in place of unsupported town graphics, and keeps it out of a working canvas', () => {
    const unsupported = renderToStaticMarkup(<GraphicsCanvas language="en" />)
    expect(unsupported).toContain('role="alert"')
    expect(unsupported).not.toContain('<canvas')
    // Screen readers would still meet a fallback left beside a working canvas.
    const context = { getExtension: () => null }
    vi.stubGlobal('document', { createElement: () => ({ getContext: () => context }) })
    const working = renderToStaticMarkup(<GraphicsCanvas language="en" />)
    expect(working).toContain('<canvas')
    expect(working).not.toContain('role="alert"')
  })
})
