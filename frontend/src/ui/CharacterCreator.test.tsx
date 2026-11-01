import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { GuestbookEntry } from '../data/guestbook'
import { DEFAULT_PLAYER_PROFILE } from '../data/playerProfile'
import { languageCopy } from '../i18n/language'
import { GraphicsCanvas } from '../scene/GraphicsCanvas'
import { CharacterCreator } from './CharacterCreator'
import { GuestbookPanel } from './GuestbookPanel'

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

  it('replaces unsupported town graphics with an announced fallback instead of a blank canvas', () => {
    const markup = renderToStaticMarkup(<GraphicsCanvas language="en" />)
    expect(markup).toContain('role="alert"')
    expect(markup).not.toContain('<canvas')
  })

  it('keeps the fallback out of a working canvas, where screen readers would still meet it', () => {
    const context = { getExtension: () => null }
    vi.stubGlobal('document', { createElement: () => ({ getContext: () => context }) })
    const markup = renderToStaticMarkup(<GraphicsCanvas language="en" />)
    expect(markup).toContain('<canvas')
    expect(markup).not.toContain('role="alert"')
  })
})

describe('guestbook panel', () => {
  const entry: GuestbookEntry = {
    id: 'maple',
    name: 'Maple',
    messages: { en: 'Maple loves the fountain' },
    createdAt: '2026-10-03T18:30:00.000Z',
    profile: { ...DEFAULT_PLAYER_PROFILE, name: 'Maple' },
  }
  const props = {
    language: 'en' as const,
    status: 'ready' as const,
    entries: [entry],
    own: null,
    currentProfile: DEFAULT_PLAYER_PROFILE,
    retry: vi.fn(),
    write: vi.fn(),
    onClose: vi.fn(),
  }
  const copy = languageCopy.en.guestbook

  it('does not offer writing until the board has loaded', () => {
    expect(renderToStaticMarkup(<GuestbookPanel {...props} />)).toContain('guestbook-write-button')
    for (const status of ['loading', 'error'] as const) {
      expect(renderToStaticMarkup(<GuestbookPanel {...props} status={status} entries={[]} />)).not.toContain(
        'guestbook-write-button',
      )
    }
  })

  it('tells the writer their note awaits review and offers to revise today’s note instead of a new one', () => {
    const own = { ...entry, id: 'mine', status: 'pending' as const, revisable: true }
    const markup = renderToStaticMarkup(<GuestbookPanel {...props} own={own} />)
    expect(markup).toContain(copy.ownPending)
    expect(markup).toContain(copy.reviseNote)
    expect(markup).not.toContain(copy.leaveNote)
  })
})
