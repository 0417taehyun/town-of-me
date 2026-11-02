import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_PLAYER_PROFILE } from '../data/playerProfile'
import { GraphicsCanvas } from '../scene/GraphicsCanvas'
import { CharacterCreator } from './CharacterCreator'

const creatorMarkup = (profile = DEFAULT_PLAYER_PROFILE) =>
  renderToStaticMarkup(
    <CharacterCreator
      language="en"
      profile={profile}
      firstEntry={false}
      onApply={async () => undefined}
      onCancel={vi.fn()}
      onActivateAudio={vi.fn()}
    />,
  )

describe('non-WebGL UI', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('asks for a self-description only when the visitor chooses to describe themselves', () => {
    expect(creatorMarkup()).not.toContain('name="gender-description"')
    const selfDescribed = { ...DEFAULT_PLAYER_PROFILE, genderIdentity: 'self-described' as const }
    expect(creatorMarkup(selfDescribed)).toContain('name="gender-description"')
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
