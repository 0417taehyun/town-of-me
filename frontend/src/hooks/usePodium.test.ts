import { describe, expect, it } from 'vitest'
import type { Podium } from '../data/leaderboardApi'
import { nextPodiumReadAt, PODIUM_REFRESH_MS, podiumAfterFailure } from './usePodium'

const thisWeek: Podium = { season: '2026-11-09', rows: [] }
// This week's statues step down as the next Monday starts in Korea: 2026-11-16 00:00 KST.
const nextWeekStarts = Date.parse('2026-11-15T15:00:00.000Z')

describe('the town’s weekly statues', () => {
  it('reads again as the KST week turns, then every few minutes, and never in a loop on a clock that runs ahead', () => {
    expect(nextPodiumReadAt(nextWeekStarts - 1, thisWeek)).toBe(nextWeekStarts)
    expect(nextPodiumReadAt(nextWeekStarts - PODIUM_REFRESH_MS - 1, thisWeek)).toBe(nextWeekStarts - 1)
    // A read at midnight that still got last week's statues (a clock ahead of the server's) tries again later.
    expect(nextPodiumReadAt(nextWeekStarts, thisWeek)).toBe(nextWeekStarts + PODIUM_REFRESH_MS)
    expect(nextPodiumReadAt(nextWeekStarts, { season: '2026-11-16', rows: [] })).toBe(
      nextWeekStarts + PODIUM_REFRESH_MS,
    )
  })

  it('keeps its statues through a failed read while their week lasts, and empties the pedestals once it is over', () => {
    expect(podiumAfterFailure(thisWeek, nextWeekStarts - 1)).toBe(thisWeek)
    expect(podiumAfterFailure(thisWeek, nextWeekStarts)).toBeNull()
  })
})
