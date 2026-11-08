import { requestJson } from './apiClient'
import { getBrowserSessionStore } from './visitorSession'

// Anonymous daily totals of what people do in the town; backend/src/siteStats.ts keeps the list and decides what
// counts. A count is only ever an event's name, and for a conversation the public id of the resident: never a note's
// text, a character, a name, or anything from the camera. No request carries a cookie, and nothing is awaited, so no
// count can hold up or break what the visitor is doing.

/** What counts once per tab, so a total reads as tabs that did it; a conversation is the one thing that counts each time. */
export type TabEvent =
  | 'entered-town'
  | 'character-finished'
  | 'first-talk'
  | 'guestbook-opened'
  | 'contact-opened'
  | 'linkedin-opened'
  | 'map-opened'
  | 'photo-taken'
  | 'ballpark-entered'

type TabStore = Pick<Storage, 'getItem' | 'setItem'>
export type PrivacySignals = { globalPrivacyControl?: boolean; doNotTrack?: string | null }

const TOWN_PATH = '/'
const COUNTED_KEY_PREFIX = 'town-of-me-counted:'

/** Only the town itself counts, so `/admin`, `/privacy`, and the game never do, and a browser's refusal always wins. */
export function mayCount(pathname: string, signals: PrivacySignals) {
  return pathname === TOWN_PATH && signals.globalPrivacyControl !== true && signals.doNotTrack !== '1'
}

/** Whether this tab has not counted `event` yet, which it then remembers. */
export function firstTimeInTab(event: TabEvent, store: TabStore) {
  const key = `${COUNTED_KEY_PREFIX}${event}`
  if (store.getItem(key)) return false
  store.setItem(key, '1')
  return true
}

/** `keepalive` lets the count outlive a page the visitor is leaving, such as for a venue's page or a mail app. */
export function sendSiteEvent(body: { event: string; subject?: string }) {
  return requestJson('/v1/events', {
    method: 'POST',
    body: JSON.stringify(body),
    keepalive: true,
    credentials: 'omit',
    referrerPolicy: 'no-referrer',
  }).then(
    () => undefined,
    () => undefined,
  )
}

/** Runs what sends a count, storage included: a tab that cannot remember counts nothing, and no count disturbs a visit. */
export function quietly(count: () => void) {
  try {
    count()
  } catch {
    // Nothing to tell anyone: the total is one short.
  }
}

/** Fire and forget: adds to a total the first time this tab does `event`. */
export function recordSiteEvent(event: TabEvent) {
  quietly(() => {
    if (!mayCount(window.location.pathname, navigator)) return
    const store = getBrowserSessionStore()
    if (store && firstTimeInTab(event, store)) void sendSiteEvent({ event })
  })
}

/** Fire and forget: a conversation with the resident `residentId` has started, and maybe this tab's first. */
export function recordConversationStart(residentId: string) {
  recordSiteEvent('first-talk')
  quietly(() => {
    if (mayCount(window.location.pathname, navigator))
      void sendSiteEvent({ event: 'resident-talk', subject: residentId })
  })
}

/** A dialogue's link is the owner's contact email or a resident's LinkedIn profile. */
export function dialogueLinkEvent(href: string): TabEvent {
  return href.startsWith('mailto:') ? 'contact-opened' : 'linkedin-opened'
}
