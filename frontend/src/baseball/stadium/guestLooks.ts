import { useEffect, useState } from 'react'
import { fetchGuestbook } from '../../data/guestbookApi'
import {
  DEFAULT_PLAYER_PROFILE,
  normalizePlayerProfile,
  type PlayerProfile,
  profileAppearance,
  randomizePlayerAppearance,
} from '../../data/playerProfile'
import { createSeededRandom } from '../game/seededRandom'

// The people around the play, the crowd and the players on both teams, look like the town's visitors: the approved
// guestbook entries' characters, then random characters in the town's preset colors for the rest. Only how a character
// looks is kept, never a name.

/**
 * `count` looks for `seed`: every approved look in a seeded order (as many as fit), then random ones, the same for the
 * same looks and seed on every visit.
 */
export function pickLooks(approved: readonly PlayerProfile[], count: number, seed: number): PlayerProfile[] {
  const random = createSeededRandom(seed)
  const shuffled = approved
    .map((look) => ({ look, order: random() }))
    .sort((first, second) => first.order - second.order)
    .slice(0, count)
    .map(({ look }) => normalizePlayerProfile(profileAppearance(look)))
  const padding = Array.from({ length: count - shuffled.length }, () =>
    randomizePlayerAppearance(DEFAULT_PLAYER_PROFILE, random, 0),
  )
  return [...shuffled, ...padding]
}

/** The approved guestbook entries' looks, once they arrive; none while they load or if they cannot be read. */
export function useApprovedLooks() {
  const [looks, setLooks] = useState<PlayerProfile[]>([])
  useEffect(() => {
    let current = true
    fetchGuestbook()
      .then(({ entries }) => current && setLooks(entries.map((entry) => entry.profile)))
      .catch(() => undefined)
    return () => {
      current = false
    }
  }, [])
  return looks
}
