import { useSyncExternalStore } from 'react'
import { seasonEndsAt } from '../data/ballparkRules'
import { fetchPodium, type Podium } from '../data/leaderboardApi'

// This week's statues for the town (town-statues §2), shared by the podium garden and its card, so the two never
// disagree or read twice. Read once something shows them, then again every few minutes while the tab is in view, when
// it comes back after that, and as the KST week turns. A failed read keeps what the town had while its week lasts;
// the town never says a read failed: an empty pedestal simply waits for a challenger.

/** How long the town keeps its statues before reading them again; the server lets caches keep them a minute. */
export const PODIUM_REFRESH_MS = 5 * 60 * 1000

/**
 * When the town reads its statues next: a while after its last read at `readAt`, or as the week they belong to ends,
 * if that comes first and has not already passed (a device clock ahead of the server's never reads in a loop).
 */
export function nextPodiumReadAt(readAt: number, podium: Podium | null) {
  const due = readAt + PODIUM_REFRESH_MS
  const weekEnds = podium ? seasonEndsAt(podium.season) : Number.POSITIVE_INFINITY
  return weekEnds > readAt ? Math.min(due, weekEnds) : due
}

/** What the town keeps after a failed read at `now`: its statues while their week lasts, then empty pedestals. */
export function podiumAfterFailure(podium: Podium | null, now: number) {
  return podium && now < seasonEndsAt(podium.season) ? podium : null
}

type PodiumStore = {
  podium: Podium | null
  readAt: number
  reading: boolean
  timer: number | undefined
  listeners: Set<() => void>
}

const store: PodiumStore = {
  podium: null,
  readAt: Number.NEGATIVE_INFINITY,
  reading: false,
  timer: undefined,
  listeners: new Set(),
}

/** Reads the statues once, past this browser's copy when their week has ended, and tells everyone showing them. */
export async function readPodium() {
  if (store.reading) return
  store.reading = true
  const fresh = store.podium !== null && Date.now() >= seasonEndsAt(store.podium.season)
  store.podium = await fetchPodium(fresh).catch(() => podiumAfterFailure(store.podium, Date.now()))
  store.readAt = Date.now()
  store.reading = false
  store.listeners.forEach((listener) => listener())
  readPodiumWhenDue()
}

/** Reads now if a read is due and the tab is in view, or waits until one is due; nothing while nothing shows them. */
export function readPodiumWhenDue() {
  window.clearTimeout(store.timer)
  if (store.listeners.size === 0 || document.hidden) return
  const wait = nextPodiumReadAt(store.readAt, store.podium) - Date.now()
  if (wait <= 0) {
    void readPodium()
    return
  }
  store.timer = window.setTimeout(readPodiumWhenDue, wait)
}

export function subscribePodium(listener: () => void) {
  store.listeners.add(listener)
  document.addEventListener('visibilitychange', readPodiumWhenDue)
  readPodiumWhenDue()
  return () => {
    store.listeners.delete(listener)
    if (store.listeners.size > 0) return
    window.clearTimeout(store.timer)
    document.removeEventListener('visibilitychange', readPodiumWhenDue)
  }
}

export function currentPodium() {
  return store.podium
}

/** This week's statues, or `null` until the first read and after a week ends without one. */
export function usePodium() {
  return useSyncExternalStore(subscribePodium, currentPodium)
}
