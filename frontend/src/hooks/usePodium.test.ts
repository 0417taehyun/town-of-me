import { describe, expect, it } from 'vitest'
import type { Podium } from '../data/leaderboardApi'
import { nextPodiumReadAt, PODIUM_REFRESH_MS, podiumAfterFailure } from './usePodium'

const november: Podium = { season: '2026-11', rows: [] }
// November's statues step down as December starts in Korea: 2026-12-01 00:00 KST.
const decemberStarts = Date.parse('2026-11-30T15:00:00.000Z')

describe('the town’s monthly statues', () => {
  it('reads again as the KST month turns, then every few minutes, and never in a loop on a clock that runs ahead', () => {
    expect(nextPodiumReadAt(decemberStarts - 1, november)).toBe(decemberStarts)
    expect(nextPodiumReadAt(decemberStarts - PODIUM_REFRESH_MS - 1, november)).toBe(decemberStarts - 1)
    // A read at midnight that still got November's statues (a clock ahead of the server's) tries again later.
    expect(nextPodiumReadAt(decemberStarts, november)).toBe(decemberStarts + PODIUM_REFRESH_MS)
    expect(nextPodiumReadAt(decemberStarts, { season: '2026-12', rows: [] })).toBe(decemberStarts + PODIUM_REFRESH_MS)
  })

  it('keeps its statues through a failed read while their month lasts, and empties the pedestals once it is over', () => {
    expect(podiumAfterFailure(november, decemberStarts - 1)).toBe(november)
    expect(podiumAfterFailure(november, decemberStarts)).toBeNull()
  })
})
