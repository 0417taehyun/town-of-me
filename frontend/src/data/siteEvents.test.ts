import { afterEach, describe, expect, it, vi } from 'vitest'
import { dialogueLinkEvent, recordConversationStart, recordSiteEvent, sendSiteEvent } from './siteEvents'

function memoryStorage(): Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> {
  const values = new Map<string, string>()
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => void values.set(key, value),
    removeItem: (key) => void values.delete(key),
  }
}

/** A tab at `pathname` whose browser sends `signals`; returns what it sent. */
function tab(pathname = '/', signals: object = {}, sessionStorage: object = memoryStorage()) {
  const sent = vi.fn<typeof fetch>(() => Promise.resolve(new Response(null, { status: 204 })))
  vi.stubGlobal('fetch', sent)
  vi.stubGlobal('navigator', signals)
  vi.stubGlobal('window', { location: { pathname }, sessionStorage })
  return sent
}

const bodies = (sent: ReturnType<typeof tab>) => sent.mock.calls.map(([, init]) => JSON.parse(String(init?.body)))

afterEach(() => vi.unstubAllGlobals())

describe('recordSiteEvent', () => {
  it('sends only the event, with no cookie, surviving the page', () => {
    const sent = tab()
    recordSiteEvent('map-opened')
    expect(sent).toHaveBeenCalledTimes(1)
    const [path, init] = sent.mock.calls[0]
    expect(path).toBe('/v1/events')
    expect(init).toMatchObject({ method: 'POST', keepalive: true, credentials: 'omit', referrerPolicy: 'no-referrer' })
    expect(bodies(sent)).toEqual([{ event: 'map-opened' }])
  })

  it('counts each event once per tab, and a new tab again', () => {
    const storage = memoryStorage()
    const sent = tab('/', {}, storage)
    recordSiteEvent('map-opened')
    recordSiteEvent('map-opened')
    recordSiteEvent('photo-taken')
    expect(bodies(sent)).toEqual([{ event: 'map-opened' }, { event: 'photo-taken' }])
    const nextTab = tab()
    recordSiteEvent('map-opened')
    expect(nextTab).toHaveBeenCalledTimes(1)
  })

  it.each([
    ['Global Privacy Control', '/', { globalPrivacyControl: true }],
    ['Do Not Track', '/', { doNotTrack: '1' }],
    ['the editor', '/admin', {}],
    ['the editor with a trailing slash', '/admin/', {}],
    ['the privacy notice', '/privacy', {}],
    ['the game', '/baseball', {}],
  ])('sends nothing under %s, and spends nothing of this tab', (_name, pathname, signals) => {
    const storage = memoryStorage()
    const sent = tab(pathname, signals, storage)
    recordSiteEvent('map-opened')
    recordConversationStart('fern')
    expect(sent).not.toHaveBeenCalled()
    expect(storage.getItem('town-of-me-counted:map-opened')).toBeNull()
  })

  it('still counts when the signals say the visitor has not refused', () => {
    const sent = tab('/', { globalPrivacyControl: false, doNotTrack: 'unspecified' })
    recordSiteEvent('map-opened')
    expect(sent).toHaveBeenCalledTimes(1)
  })

  it('counts nothing and throws nothing when the tab cannot remember', () => {
    const throwing = {
      getItem: () => {
        throw new Error('blocked')
      },
    }
    const sent = tab('/', {}, throwing)
    expect(() => recordSiteEvent('map-opened')).not.toThrow()
    expect(sent).not.toHaveBeenCalled()
    const denied = tab()
    vi.stubGlobal('window', {
      location: { pathname: '/' },
      get sessionStorage() {
        throw new Error('denied')
      },
    })
    expect(() => recordSiteEvent('map-opened')).not.toThrow()
    expect(denied).not.toHaveBeenCalled()
  })

  it('throws nothing when the request fails, at once or later', async () => {
    tab()
    vi.stubGlobal('fetch', () => {
      throw new Error('no fetch')
    })
    expect(() => recordSiteEvent('map-opened')).not.toThrow()
    expect(() => recordConversationStart('fern')).not.toThrow()
    vi.stubGlobal('fetch', () => Promise.reject(new Error('offline')))
    await expect(sendSiteEvent({ event: 'map-opened' })).resolves.toBeUndefined()
  })
})

describe('recordConversationStart', () => {
  it('names the resident every time, and counts the first talk once per tab', () => {
    const sent = tab()
    recordConversationStart('fern')
    recordConversationStart('fern')
    recordConversationStart('moss')
    expect(bodies(sent)).toEqual([
      { event: 'first-talk' },
      { event: 'resident-talk', subject: 'fern' },
      { event: 'resident-talk', subject: 'fern' },
      { event: 'resident-talk', subject: 'moss' },
    ])
  })
})

describe('dialogueLinkEvent', () => {
  it('tells the contact email from a LinkedIn profile', () => {
    expect(dialogueLinkEvent('mailto:owner@example.com')).toBe('contact-opened')
    expect(dialogueLinkEvent('https://www.linkedin.com/in/fern')).toBe('linkedin-opened')
  })
})
